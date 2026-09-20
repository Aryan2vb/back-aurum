import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  Req,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  StreamableFile,
  UseInterceptors,
  UploadedFile,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request } from 'express';
import { BackupService } from './backup.service';
import { Roles } from '../auth/roles.decorator';
import { OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import * as fs from 'fs';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Helper to verify if the requesting user is an authorized Super Admin.
   * Checks SUPER_ADMIN_EMAILS environment variable or optional header.
   */
  private assertSuperAdmin(user: CurrentUserData, req?: Request): void {
    const rawList = process.env.SUPER_ADMIN_EMAILS || '';
    const superAdmins = rawList
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = user?.email?.toLowerCase();
    const isEmailAllowed = userEmail && superAdmins.includes(userEmail);

    const superAdminSecret = process.env.SUPER_ADMIN_SECRET;
    const providedSecret = req?.headers['x-super-admin-secret'];
    const isSecretValid = superAdminSecret && providedSecret === superAdminSecret;

    if (!isEmailAllowed && !isSecretValid) {
      throw new ForbiddenException(
        'Super Admin access required. You do not have permission to access system-wide database backups across other organizations.',
      );
    }
  }

  private checkIsSuperAdmin(user: CurrentUserData, req?: Request): boolean {
    const rawList = process.env.SUPER_ADMIN_EMAILS || '';
    const superAdmins = rawList
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = user?.email?.toLowerCase();
    const isEmailAllowed = !!userEmail && superAdmins.includes(userEmail);

    const superAdminSecret = process.env.SUPER_ADMIN_SECRET;
    const providedSecret = req?.headers['x-super-admin-secret'];
    const isSecretValid = !!superAdminSecret && providedSecret === superAdminSecret;

    return isEmailAllowed || isSecretValid;
  }

  /**
   * Status endpoint: Returns user capabilities for the backup UI.
   */
  @Get('status')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async getBackupStatus(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return {
      canBackupOrg: true,
      isSuperAdmin: this.checkIsSuperAdmin(user, req),
    };
  }

  /**
   * Export organization-specific data snapshot.
   * Accessible by OWNER and ADMIN of their specific organization ONLY.
   */
  @Get('organization')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async exportOrganization(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.backupService.exportOrganizationData(
      user.organizationId,
      user.userId,
      ipAddress,
      userAgent,
    );

    const jsonString = JSON.stringify(result.content, null, 2);
    const buffer = Buffer.from(jsonString, 'utf-8');

    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': buffer.length,
    });

    res.status(HttpStatus.OK).send(buffer);
  }

  /**
   * Import/Restore organization-specific data from uploaded JSON backup file.
   * Accessible by OWNER and ADMIN of the organization.
   */
  @Post('organization/import')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    }),
  )
  async importOrganization(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string } | undefined,
    @Body() body: any,
    @Req() req: Request,
  ) {
    let payload: any;

    if (file?.buffer) {
      try {
        const text = file.buffer.toString('utf-8');
        payload = JSON.parse(text);
      } catch (err) {
        throw new BadRequestException('Uploaded file is not valid JSON.');
      }
    } else if (body && (body.data || body.organization)) {
      payload = body;
    } else {
      throw new BadRequestException('Please provide a backup JSON file or payload to import.');
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    return this.backupService.importOrganizationData(
      user.organizationId,
      payload,
      user.userId,
      ipAddress,
      userAgent,
    );
  }

  /**
   * Get organization-specific backup history.
   */
  @Get('organization/history')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async getOrgBackupHistory(@CurrentUser() user: CurrentUserData) {
    return this.backupService.getBackupHistory(user.organizationId);
  }

  /**
   * Super Admin ONLY: Trigger full system database backup across all orgs.
   */
  @Post('admin/full')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async createFullBackup(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    this.assertSuperAdmin(user, req);

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    return this.backupService.createFullDatabaseBackup(user.userId, ipAddress, userAgent);
  }

  /**
   * Super Admin ONLY: List all stored server database dumps.
   */
  @Get('admin/stored')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async listStoredBackups(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    this.assertSuperAdmin(user, req);
    return this.backupService.listStoredBackups();
  }

  /**
   * Super Admin ONLY: Get full system backup history.
   */
  @Get('admin/history')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async getSystemBackupHistory(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    this.assertSuperAdmin(user, req);
    return this.backupService.getBackupHistory();
  }

  /**
   * Super Admin ONLY: Download a specific full backup dump file from server.
   */
  @Get('admin/download/:filename')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async downloadBackupFile(
    @Param('filename') filename: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.assertSuperAdmin(user, req);

    const filePath = this.backupService.getBackupFilePath(filename);
    const fileStream = fs.createReadStream(filePath);

    res.set({
      'Content-Type': filename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(fileStream);
  }
}

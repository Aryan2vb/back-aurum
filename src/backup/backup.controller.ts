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
import * as path from 'path';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Super Admin status is granted only to accounts whose email is listed in
   * SUPER_ADMIN_EMAILS. (A shared header secret used to grant this to any
   * OWNER/ADMIN of any organization and was removed.)
   */
  private checkIsSuperAdmin(user: CurrentUserData): boolean {
    const superAdmins = (process.env.SUPER_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = user?.email?.trim().toLowerCase();
    return !!userEmail && superAdmins.includes(userEmail);
  }

  private assertSuperAdmin(user: CurrentUserData): void {
    if (!this.checkIsSuperAdmin(user)) {
      throw new ForbiddenException(
        'Super Admin access required. You do not have permission to access system-wide database backups across other organizations.',
      );
    }
  }

  /**
   * Status endpoint: Returns user capabilities for the backup UI.
   */
  @Get('status')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async getBackupStatus(@CurrentUser() user: CurrentUserData) {
    return {
      canBackupOrg: true,
      isSuperAdmin: this.checkIsSuperAdmin(user),
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
   * Overwrites live records, so it is restricted to the organization OWNER.
   */
  @Post('organization/import')
  @Roles(OrganizationRole.OWNER)
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
    this.assertSuperAdmin(user);

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    return this.backupService.createFullDatabaseBackup(user.userId, ipAddress, userAgent);
  }

  /**
   * Super Admin ONLY: List all stored server database dumps.
   */
  @Get('admin/stored')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async listStoredBackups(@CurrentUser() user: CurrentUserData) {
    this.assertSuperAdmin(user);
    return this.backupService.listStoredBackups();
  }

  /**
   * Super Admin ONLY: Get full system backup history.
   */
  @Get('admin/history')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async getSystemBackupHistory(@CurrentUser() user: CurrentUserData) {
    this.assertSuperAdmin(user);
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.assertSuperAdmin(user);

    const filePath = this.backupService.getBackupFilePath(filename);
    const safeFilename = path.basename(filePath);
    const fileStream = fs.createReadStream(filePath);

    res.set({
      'Content-Type': safeFilename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    });

    return new StreamableFile(fileStream);
  }
}

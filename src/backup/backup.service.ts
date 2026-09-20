import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

const PG_DUMP_TIMEOUT_MS = 10 * 60 * 1000;

/** Never export credential material in a system JSON snapshot. */
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Split a Postgres URL into libpq environment variables so the password never
 * appears in argv (`ps`) or in an exec error message, and so Prisma-only query
 * params (schema, pgbouncer, connection_limit) don't break pg_dump.
 */
export function buildPgEnv(dbUrl: string): NodeJS.ProcessEnv {
  const url = new URL(dbUrl);
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PGHOST = url.hostname;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

const jsonFieldCache = new Map<string, Set<string>>();

/** Names of Json columns on a Prisma model (null on these needs Prisma.DbNull). */
function jsonFieldsOf(modelKey: string): Set<string> {
  const modelName = modelKey.charAt(0).toUpperCase() + modelKey.slice(1);
  let cached = jsonFieldCache.get(modelName);
  if (!cached) {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
    cached = new Set((model?.fields ?? []).filter((f) => f.type === 'Json').map((f) => f.name));
    jsonFieldCache.set(modelName, cached);
  }
  return cached;
}

export interface ExportMetadata {
  version: string;
  generatedAt: string;
  organizationId?: string;
  organizationName?: string;
  type: 'ORGANIZATION_BACKUP' | 'FULL_SYSTEM_BACKUP';
  recordCounts: Record<string, number>;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir = path.resolve(process.cwd(), 'backups');
  private fullBackupInProgress = false;

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.backupDir)) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        this.logger.error(`Failed to create backup directory: ${err.message}`);
      }
    }
  }

  /**
   * Export all data strictly scoped to a specific organization.
   */
  async exportOrganizationData(organizationId: string, userId?: string, ipAddress?: string, userAgent?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        invoiceSettings: true,
        accessPolicy: true,
        metalPurities: true,
      },
    });

    if (!org) {
      throw new NotFoundException(`Organization with id ${organizationId} not found`);
    }

    this.logger.log(`Starting export for organization: ${org.name} (${organizationId})`);

    // Fetch all related organization records in parallel
    const [
      members,
      customers,
      contactDetails,
      locations,
      socialContexts,
      metaTrackings,
      accounts,
      ledgerEntries,
      invoices,
      invoiceItems,
      invoicePayments,
      invoiceSequences,
      vendors,
      purchaseInvoices,
      purchaseInvoiceItems,
      purchasePayments,
      stockBalances,
      stockLedgers,
      financialAccounts,
      financialTransactions,
      financialMovements,
      bankStatementImports,
      bankStatementLines,
      documents,
    ] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where: { organizationId },
        include: {
          user: {
            select: { id: true, email: true, fullName: true, createdAt: true },
          },
        },
      }),
      this.prisma.customer.findMany({ where: { organizationId } }),
      this.prisma.contactDetail.findMany({ where: { organizationId } }),
      this.prisma.location.findMany({ where: { organizationId } }),
      this.prisma.socialContext.findMany({ where: { organizationId } }),
      this.prisma.metaTracking.findMany({ where: { organizationId } }),
      this.prisma.account.findMany({ where: { organizationId } }),
      this.prisma.ledgerEntry.findMany({ where: { organizationId } }),
      this.prisma.invoice.findMany({ where: { organizationId } }),
      this.prisma.invoiceItem.findMany({ where: { organizationId } }),
      this.prisma.invoicePayment.findMany({ where: { organizationId } }),
      this.prisma.invoiceSequence.findMany({ where: { organizationId } }),
      this.prisma.vendor.findMany({ where: { organizationId } }),
      this.prisma.purchaseInvoice.findMany({ where: { organizationId } }),
      this.prisma.purchaseInvoiceItem.findMany({ where: { organizationId } }),
      this.prisma.purchasePayment.findMany({ where: { organizationId } }),
      this.prisma.stockBalance.findMany({ where: { organizationId } }),
      this.prisma.stockLedger.findMany({ where: { organizationId } }),
      this.prisma.financialAccount.findMany({ where: { organizationId } }),
      this.prisma.financialTransaction.findMany({ where: { organizationId } }),
      this.prisma.financialMovement.findMany({ where: { organizationId } }),
      this.prisma.bankStatementImport.findMany({ where: { organizationId } }),
      this.prisma.bankStatementLine.findMany({ where: { organizationId } }),
      this.prisma.document.findMany({ where: { organizationId } }),
    ]);

    const recordCounts = {
      members: members.length,
      customers: customers.length,
      contactDetails: contactDetails.length,
      locations: locations.length,
      socialContexts: socialContexts.length,
      metaTrackings: metaTrackings.length,
      accounts: accounts.length,
      ledgerEntries: ledgerEntries.length,
      invoices: invoices.length,
      invoiceItems: invoiceItems.length,
      invoicePayments: invoicePayments.length,
      invoiceSequences: invoiceSequences.length,
      vendors: vendors.length,
      purchaseInvoices: purchaseInvoices.length,
      purchaseInvoiceItems: purchaseInvoiceItems.length,
      purchasePayments: purchasePayments.length,
      stockBalances: stockBalances.length,
      stockLedgers: stockLedgers.length,
      metalPurities: org.metalPurities.length,
      financialAccounts: financialAccounts.length,
      financialTransactions: financialTransactions.length,
      financialMovements: financialMovements.length,
      bankStatementImports: bankStatementImports.length,
      bankStatementLines: bankStatementLines.length,
      documents: documents.length,
    };

    const metadata: ExportMetadata = {
      version: '1.0.0',
      type: 'ORGANIZATION_BACKUP',
      organizationId,
      organizationName: org.name,
      generatedAt: new Date().toISOString(),
      recordCounts,
    };

    const payload = {
      metadata,
      organization: org,
      data: {
        members,
        customers,
        contactDetails,
        locations,
        socialContexts,
        metaTrackings,
        accounts,
        ledgerEntries,
        invoices,
        invoiceItems,
        invoicePayments,
        invoiceSequences,
        vendors,
        purchaseInvoices,
        purchaseInvoiceItems,
        purchasePayments,
        stockBalances,
        stockLedgers,
        financialAccounts,
        financialTransactions,
        financialMovements,
        bankStatementImports,
        bankStatementLines,
        documents,
      },
    };

    const payloadString = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(payloadString, 'utf8');

    // Record an audit log for this backup
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          userId: userId || null,
          action: AuditAction.EXPORT,
          entityType: 'ORGANIZATION_BACKUP',
          metadata: {
            organizationName: org.name,
            recordCounts,
            fileSizeBytes: sizeBytes,
            format: 'json',
            timestamp: metadata.generatedAt,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record audit log for org export: ${err.message}`);
    }

    return {
      filename: `aurum_${org.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      metadata,
      content: payload,
    };
  }

  /**
   * Import / Restore organization data from a previously downloaded JSON backup.
   */
  async importOrganizationData(
    targetOrgId: string,
    backupJson: any,
    userId?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (!backupJson || !backupJson.data) {
      throw new BadRequestException(
        'Invalid backup file format. Expected a valid JSON file generated by Aurum backup.',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: targetOrgId },
    });

    if (!org) {
      throw new NotFoundException(`Organization with id ${targetOrgId} not found`);
    }

    const { data, organization: sourceOrg, metadata } = backupJson;
    const sourceOrgId = metadata?.organizationId || sourceOrg?.id;
    const sourceOrgName = metadata?.organizationName || sourceOrg?.name || 'Another Organization';

    // Strict Tenant Isolation: the backup must declare its origin and it must be this org.
    if (!sourceOrgId) {
      throw new BadRequestException(
        'Invalid backup file: it does not identify the organization it was exported from.',
      );
    }
    if (sourceOrgId !== targetOrgId) {
      throw new BadRequestException(
        `Organization Mismatch: This backup file belongs to "${sourceOrgName}" (ID: ${sourceOrgId}), but your active organization is "${org.name}". To prevent data contamination, you cannot import another organization's backup into this workspace.`,
      );
    }

    const restoredCounts: Record<string, number> = {};

    // Ordered list of entities to preserve foreign key constraints
    const importPlan: Array<{ key: string; model: string }> = [
      { key: 'financialAccounts', model: 'financialAccount' },
      { key: 'financialTransactions', model: 'financialTransaction' },
      { key: 'customers', model: 'customer' },
      { key: 'contactDetails', model: 'contactDetail' },
      { key: 'locations', model: 'location' },
      { key: 'socialContexts', model: 'socialContext' },
      { key: 'metaTrackings', model: 'metaTracking' },
      { key: 'accounts', model: 'account' },
      { key: 'ledgerEntries', model: 'ledgerEntry' },
      { key: 'invoices', model: 'invoice' },
      { key: 'invoiceItems', model: 'invoiceItem' },
      { key: 'invoicePayments', model: 'invoicePayment' },
      { key: 'invoiceSequences', model: 'invoiceSequence' },
      { key: 'vendors', model: 'vendor' },
      { key: 'purchaseInvoices', model: 'purchaseInvoice' },
      { key: 'purchaseInvoiceItems', model: 'purchaseInvoiceItem' },
      { key: 'purchasePayments', model: 'purchasePayment' },
      { key: 'stockBalances', model: 'stockBalance' },
      { key: 'stockLedgers', model: 'stockLedger' },
      { key: 'financialMovements', model: 'financialMovement' },
      { key: 'bankStatementImports', model: 'bankStatementImport' },
      { key: 'bankStatementLines', model: 'bankStatementLine' },
      { key: 'documents', model: 'document' },
    ];

    // Counters that must never move backwards when merging an older backup
    // (a lower sequence would collide with invoices created after the backup).
    const monotonicFields: Record<string, string> = { invoiceSequence: 'nextSequence' };

    await this.prisma.$transaction(
      async (tx: any) => {
        // 0. Tenant isolation: refuse the whole import if any record id in the file
        // already belongs to another organization (ids are global primary keys).
        const idsByModel: Array<{ model: string; ids: string[] }> = [];
        if (Array.isArray(sourceOrg?.metalPurities)) {
          idsByModel.push({
            model: 'orgMetalPurity',
            ids: sourceOrg.metalPurities.filter((p: any) => p?.id).map((p: any) => String(p.id)),
          });
        }
        for (const { key, model } of importPlan) {
          const items = data[key];
          if (!Array.isArray(items)) continue;
          idsByModel.push({
            model,
            ids: items.filter((i: any) => i?.id).map((i: any) => String(i.id)),
          });
        }
        for (const { model, ids } of idsByModel) {
          if (!ids.length || !tx[model]) continue;
          const foreign = await tx[model].findFirst({
            where: { id: { in: ids }, organizationId: { not: targetOrgId } },
            select: { id: true },
          });
          if (foreign) {
            throw new BadRequestException(
              'Import rejected: the file contains records that belong to another organization.',
            );
          }
        }

        // 1. Metal Purities
        if (Array.isArray(sourceOrg?.metalPurities)) {
          let count = 0;
          for (const p of sourceOrg.metalPurities) {
            if (!p || !p.id) continue;
            const sanitized: any = {
              organizationId: targetOrgId,
              metalType: p.metalType,
              label: p.label,
              sortOrder: p.sortOrder ?? 0,
              isActive: p.isActive !== undefined ? p.isActive : true,
            };
            await this.writeRecord(tx, 'orgMetalPurity', p.id, targetOrgId, sanitized);
            count++;
          }
          restoredCounts.metalPurities = count;
        }

        // 2. Sequential entity imports
        for (const { key, model } of importPlan) {
          const items = data[key];
          if (!Array.isArray(items) || items.length === 0) continue;

          const jsonFields = jsonFieldsOf(model);
          let count = 0;
          for (const item of items) {
            if (!item || !item.id) continue;

            // Strip nested relational arrays/objects to prevent Prisma validation errors
            const sanitized: any = {};
            for (const [prop, val] of Object.entries(item)) {
              if (val === null || val === undefined) {
                // Prisma rejects a bare null on Json columns; it needs DbNull.
                sanitized[prop] = val === null && jsonFields.has(prop) ? Prisma.DbNull : val;
              } else if (Array.isArray(val) && !jsonFields.has(prop)) {
                // Ignore nested relation arrays
                continue;
              } else {
                // Scalars and Json fields (e.g. companySnapshot, buyerSnapshot) stay intact
                sanitized[prop] = val;
              }
            }

            sanitized.organizationId = targetOrgId;

            if (tx[model]) {
              await this.writeRecord(tx, model, item.id, targetOrgId, sanitized, monotonicFields[model], item);
              count++;
            }
          }
          restoredCounts[key] = count;
        }
      },
      { timeout: 120000 },
    );

    // Record audit log for import
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: targetOrgId,
          userId: userId || null,
          action: AuditAction.IMPORT,
          entityType: 'ORGANIZATION_BACKUP',
          metadata: {
            sourceOrgName: sourceOrg?.name || 'Unknown',
            restoredCounts,
            importedAt: new Date().toISOString(),
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to log audit record for import: ${err.message}`);
    }

    return {
      success: true,
      restoredCounts,
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Update-or-create scoped to the target organization. Deliberately not an upsert on
   * a bare id: the update only ever matches rows already owned by this organization.
   */
  private async writeRecord(
    tx: any,
    model: string,
    id: string,
    organizationId: string,
    data: Record<string, any>,
    monotonicField?: string,
    source?: Record<string, any>,
  ) {
    const updateData = { ...data };
    delete updateData.id;
    const where: Record<string, any> = { id, organizationId };
    if (monotonicField && source && source[monotonicField] != null) {
      where[monotonicField] = { lte: source[monotonicField] };
    }

    const updated = await tx[model].updateMany({ where, data: updateData });
    if (updated.count > 0) return;

    if (monotonicField) {
      const exists = await tx[model].count({ where: { id, organizationId } });
      if (exists > 0) return; // live value is newer; keep it
    }
    await tx[model].create({ data: { id, ...updateData } });
  }

  /**
   * System-Wide Full Database Backup.
   * Uses pg_dump directly if available, with a fallback to a comprehensive multi-org snapshot.
   */
  async createFullDatabaseBackup(userId?: string, ipAddress?: string, userAgent?: string) {
    if (this.fullBackupInProgress) {
      throw new ConflictException('A full system backup is already in progress.');
    }

    const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('Database connection URL (DIRECT_URL or DATABASE_URL) is not configured.');
    }

    let pgEnv: NodeJS.ProcessEnv;
    try {
      pgEnv = buildPgEnv(dbUrl);
    } catch {
      throw new Error('Database connection URL is not a valid Postgres URL.');
    }

    this.fullBackupInProgress = true;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dumpFilename = `aurum_full_db_${timestamp}.dump`;
      const dumpFilePath = path.join(this.backupDir, dumpFilename);

      this.logger.log(`Initiating full system database backup to: ${dumpFilename}`);

      let method = 'pg_dump';
      let filename = dumpFilename;
      let fileSizeBytes = 0;

      const pgDumpBin = this.findPgDumpBinary();

      try {
        // Credentials travel via PG* env vars (never argv / never in error text).
        await execFileAsync(
          pgDumpBin,
          ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpFilePath}`],
          { env: pgEnv, timeout: PG_DUMP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        );
        fs.chmodSync(dumpFilePath, 0o600);
        fileSizeBytes = fs.statSync(dumpFilePath).size;
        this.logger.log(
          `Full pg_dump completed successfully with ${pgDumpBin} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`,
        );
      } catch (pgErr: any) {
        // A failed pg_dump can leave a partial file that would otherwise look valid.
        fs.rmSync(dumpFilePath, { force: true });

        const reason =
          pgErr?.code === 'ENOENT'
            ? 'pg_dump binary not found'
            : this.redactSecrets(String(pgErr?.stderr || pgErr?.message || 'unknown error'), pgEnv)
                .trim()
                .slice(0, 300);
        this.logger.warn(
          `pg_dump failed (${reason}). Generating a reduced JSON snapshot fallback (no credentials, not a full-fidelity dump).`,
        );
        method = 'json_full_snapshot';
        filename = `aurum_full_system_${timestamp}.json`;

        // Fallback: system snapshot. Password hashes are deliberately never exported.
        const [allOrgs, allUsers] = await Promise.all([
          this.prisma.organization.findMany({
            include: {
              invoiceSettings: true,
              accessPolicy: true,
              metalPurities: true,
              members: { include: { user: { select: SAFE_USER_SELECT } } },
              customers: true,
              contactDetails: true,
              locations: true,
              socialContexts: true,
              metaTrackings: true,
              accounts: true,
              ledgerEntries: true,
              invoices: true,
              invoiceItems: true,
              invoicePayments: true,
              invoiceSequences: true,
              vendors: true,
              purchaseInvoices: true,
              purchaseInvoiceItems: true,
              purchasePayments: true,
              stockBalances: true,
              stockLedgers: true,
              financialAccounts: true,
              financialTransactions: true,
              financialMovements: true,
              bankStatementImports: true,
              bankStatementLines: true,
              documents: true,
            },
          }),
          this.prisma.user.findMany({ select: SAFE_USER_SELECT }),
        ]);

        const jsonFilePath = path.join(this.backupDir, filename);
        const dataPayload = {
          metadata: {
            version: '1.0.0',
            type: 'FULL_SYSTEM_BACKUP',
            generatedAt: new Date().toISOString(),
            organizationsCount: allOrgs.length,
            usersCount: allUsers.length,
          },
          users: allUsers,
          organizations: allOrgs,
        };

        fs.writeFileSync(jsonFilePath, JSON.stringify(dataPayload, null, 2), {
          encoding: 'utf8',
          mode: 0o600,
        });
        fileSizeBytes = fs.statSync(jsonFilePath).size;
      }

      // Try finding first org for audit logging or global log
      const primaryOrg = await this.prisma.organization.findFirst();
      if (primaryOrg) {
        try {
          await this.prisma.auditLog.create({
            data: {
              organizationId: primaryOrg.id,
              userId: userId || null,
              action: AuditAction.EXPORT,
              entityType: 'FULL_SYSTEM_BACKUP',
              metadata: {
                type: 'FULL_SYSTEM_BACKUP',
                filename,
                fileSizeBytes,
                method,
                timestamp: new Date().toISOString(),
              },
              ipAddress: ipAddress || null,
              userAgent: userAgent || null,
            },
          });
        } catch (err) {
          this.logger.warn(`Failed to record full backup audit log: ${err.message}`);
        }
      }

      return {
        success: true,
        filename,
        fileSizeBytes,
        fileSizeFormatted: `${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`,
        method,
        createdAt: new Date().toISOString(),
      };
    } finally {
      this.fullBackupInProgress = false;
    }
  }

  private redactSecrets(text: string, env: NodeJS.ProcessEnv): string {
    const password = env.PGPASSWORD;
    return password ? text.split(password).join('***') : text;
  }

  /**
   * Retrieves backup history from AuditLogs for an organization or system-wide.
   */
  async getBackupHistory(organizationId?: string) {
    const whereClause: any = { action: AuditAction.EXPORT };

    if (organizationId) {
      // An organization only sees its own exports, never system/automated dumps
      // (those are logged against an arbitrary "primary" org).
      whereClause.organizationId = organizationId;
      whereClause.entityType = 'ORGANIZATION_BACKUP';
    } else {
      // System history: AuditLog is tenant-scoped, and full backups are logged
      // against the primary organization (see createFullDatabaseBackup).
      const primaryOrg = await this.prisma.organization.findFirst();
      if (!primaryOrg) return [];
      whereClause.organizationId = primaryOrg.id;
      whereClause.entityType = 'FULL_SYSTEM_BACKUP';
    }

    const logs = await this.prisma.auditLog.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      createdAt: log.createdAt,
      initiatedBy: log.user ? log.user.fullName || log.user.email : 'System / Automated',
      metadata: log.metadata,
    }));
  }

  /**
   * List local stored backup files on server.
   */
  async listStoredBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    const files = fs.readdirSync(this.backupDir);
    return files
      .filter((f) => f.startsWith('aurum_') && (f.endsWith('.dump') || f.endsWith('.json') || f.endsWith('.sql.gz')))
      .map((f) => {
        const filePath = path.join(this.backupDir, f);
        const stats = fs.statSync(filePath);
        return {
          filename: f,
          sizeBytes: stats.size,
          sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          createdAt: stats.birthtime || stats.mtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Get file path for download if it exists and is safe.
   */
  getBackupFilePath(filename: string): string {
    const safeFilename = path.basename(filename);
    const fullPath = path.join(this.backupDir, safeFilename);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Backup file ${safeFilename} does not exist`);
    }
    return fullPath;
  }

  /**
   * Automated scheduled cron job to run daily at midnight (00:00).
   * Backs up database and cleans up backups older than 30 days.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleScheduledDailyBackup() {
    this.logger.log('Executing automated daily midnight database backup...');
    try {
      const result = await this.createFullDatabaseBackup(undefined, '127.0.0.1', 'Automated Scheduled Cron Job');
      this.logger.log(`Scheduled backup created successfully: ${result.filename} (${result.fileSizeFormatted})`);
      
      // Cleanup backups older than 30 days
      this.cleanupOldBackups(30);
    } catch (err) {
      this.logger.error(`Automated scheduled backup failed: ${err.message}`, err.stack);
    }
  }

  private cleanupOldBackups(retentionDays = 30) {
    if (!fs.existsSync(this.backupDir)) return;
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(this.backupDir);
    for (const file of files) {
      if (!file.startsWith('aurum_')) continue;
      const filePath = path.join(this.backupDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          this.logger.log(`Rotated and deleted expired backup file: ${file}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to inspect/delete file ${file}: ${err.message}`);
      }
    }
  }

  private findPgDumpBinary(): string {
    const candidates = [
      '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
      '/opt/homebrew/Cellar/postgresql@17/17.8/bin/pg_dump',
      '/opt/homebrew/opt/libpq/bin/pg_dump',
      '/opt/homebrew/Cellar/libpq/18.2/bin/pg_dump',
      '/usr/local/opt/postgresql@17/bin/pg_dump',
      '/usr/local/bin/pg_dump',
      'pg_dump',
    ];

    for (const bin of candidates) {
      if (bin.startsWith('/') && fs.existsSync(bin)) {
        return bin;
      }
    }
    return 'pg_dump';
  }
}


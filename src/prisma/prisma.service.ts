import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static readonly TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
    'Customer',
    'Account',
    'ContactDetail',
    'Location',
    'SocialContext',
    'Document',
    'MetaTracking',
    'AuditLog',
    'LedgerEntry',
    'UdharEntry',
    'Invoice',
    'InvoiceItem',
    'OrgInvoiceSettings',
    'InvoiceFooterFolder',
    'InvoiceFooterAsset',
  ]);

  private static readonly ACTIONS_REQUIRING_WHERE = new Set<string>([
    'findUnique',
    'findFirst',
    'findMany',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'upsert',
    'aggregate',
    'count',
  ]);

  private static readonly ACTIONS_REQUIRING_DATA = new Set<string>([
    'create',
    'createMany',
    'upsert',
  ]);

  private static readonly DEFAULT_POOL_SIZE = 5;
  private static readonly DEFAULT_POOL_TIMEOUT_SECONDS = 20;

  constructor() {
    super(PrismaService.buildClientOptions());

    this.$use(async (params, next) => {
      if (
        params.model &&
        PrismaService.TENANT_SCOPED_MODELS.has(params.model as Prisma.ModelName)
      ) {
        if (PrismaService.ACTIONS_REQUIRING_WHERE.has(params.action)) {
          if (!this.containsOrganizationId(params.args?.where)) {
            this.logger.warn(`Missing organizationId filter for ${params.model}.${params.action}`);
            throw new ForbiddenException(
              `Missing organizationId filter for ${params.model}.${params.action}`,
            );
          }
        }

        if (PrismaService.ACTIONS_REQUIRING_DATA.has(params.action)) {
          const args = params.args || {};
          let allEntriesScoped = true;

          if (params.action === 'upsert') {
            // For upsert, we need to check both 'create' and 'update' arguments
            const createScoped = this.containsOrganizationId(args.create);
            // 'update' is optional for enforcement if 'where' already has organizationId,
            // but for upsert we enforce organizationId in the 'create' block at minimum.
            if (!createScoped) {
              allEntriesScoped = false;
            }
          } else {
            const dataArg = args.data;
            const entries = Array.isArray(dataArg) ? dataArg : [dataArg];
            allEntriesScoped = entries.every((entry) => this.containsOrganizationId(entry));
          }

          if (!allEntriesScoped) {
            throw new ForbiddenException(
              `Missing organizationId in data for ${params.model}.${params.action}`,
            );
          }
        }
      }

      return next(params);
    });
  }

  private static buildClientOptions(): Prisma.PrismaClientOptions {
    const url = process.env.DATABASE_URL;
    if (!url) return {};

    try {
      const parsed = new URL(url);

      // Persistent NestJS servers need more than 1 connection to handle concurrent
      // requests. Use DATABASE_POOL_SIZE (default 5) to override the connection_limit
      // that is typically set to 1 in Supabase/PgBouncer DATABASE_URLs.
      const poolSize = Math.max(
        1,
        parseInt(process.env.DATABASE_POOL_SIZE || String(PrismaService.DEFAULT_POOL_SIZE), 10),
      );
      parsed.searchParams.set('connection_limit', String(poolSize));

      // Use a more lenient pool timeout (seconds) to tolerate brief contention.
      // Only set when the URL does not already specify a value.
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', String(PrismaService.DEFAULT_POOL_TIMEOUT_SECONDS));
      }

      return { datasources: { db: { url: parsed.toString() } } };
    } catch {
      return {};
    }
  }

  async onModuleInit() {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('PrismaService connected to database');
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error(
            `Failed to connect to database after ${maxRetries} attempts`,
            error instanceof Error ? error.stack : String(error),
          );
          throw error;
        }
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn(
          `Database connection attempt ${attempt} failed, retrying in ${delayMs / 1000}s... (${maxRetries - attempt} attempts left)`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('PrismaService disconnected from database');
  }

  private containsOrganizationId(input: unknown): boolean {
    if (input === null || input === undefined) {
      return false;
    }

    if (Array.isArray(input)) {
      return input.every((value) => this.containsOrganizationId(value));
    }

    if (typeof input !== 'object') {
      return false;
    }

    if ('organizationId' in (input as Record<string, unknown>)) {
      return true;
    }

    return Object.values(input as Record<string, unknown>).some((value) =>
      this.containsOrganizationId(value),
    );
  }
}

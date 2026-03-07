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
    'Credit',
    'CreditTransaction',
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

  constructor() {
    super();

    this.$use(async (params, next) => {
      if (
        params.model &&
        PrismaService.TENANT_SCOPED_MODELS.has(params.model as Prisma.ModelName)
      ) {
        if (PrismaService.ACTIONS_REQUIRING_WHERE.has(params.action)) {
          if (!this.containsOrganizationId(params.args?.where)) {
            this.logger.warn(
              `Missing organizationId filter for ${params.model}.${params.action}`,
            );
            throw new ForbiddenException(
              `Missing organizationId filter for ${params.model}.${params.action}`,
            );
          }
        }

        if (PrismaService.ACTIONS_REQUIRING_DATA.has(params.action)) {
          const dataArg = params.args?.data;
          const entries = Array.isArray(dataArg) ? dataArg : [dataArg];
          const allEntriesScoped = entries.every((entry) =>
            this.containsOrganizationId(entry),
          );

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


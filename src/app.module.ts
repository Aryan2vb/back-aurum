import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { OrganizationsModule } from './organizations/organizations.module';
import { AccessPolicyModule } from './organizations/access-policy.module';
import { CustomersModule } from './customers/customers.module';
import { CreditsModule } from './credits/credits.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ReportsModule } from './reports/reports.module';
import { UploadModule } from './uploads/upload.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { StockModule } from './stock/stock.module';
import { VendorsModule } from './vendors/vendors.module';
import { PurchasesModule } from './purchases/purchases.module';
import { FinanceModule } from './finance/finance.module';
import { BankStatementModule } from './bank-statement/bank-statement.module';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60,
        limit: 30,
      },
    ]),
    PrismaModule,
    AccessPolicyModule,
    AuthModule,
    UploadModule,
    OrganizationsModule,
    CustomersModule,
    CreditsModule,
    InvoicesModule,
    ReportsModule,
    StockModule,
    VendorsModule,
    PurchasesModule,
    FinanceModule,
    BankStatementModule,
    BackupModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}

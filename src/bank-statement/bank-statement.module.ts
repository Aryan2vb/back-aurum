import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BankStatementController } from './bank-statement.controller';
import { BankStatementService } from './bank-statement.service';

@Module({
  imports: [PrismaModule, InvoicesModule],
  controllers: [BankStatementController],
  providers: [BankStatementService],
  exports: [BankStatementService],
})
export class BankStatementModule {}

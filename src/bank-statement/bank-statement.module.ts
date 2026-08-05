import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankStatementController } from './bank-statement.controller';
import { BankStatementService } from './bank-statement.service';

@Module({
  imports: [PrismaModule],
  controllers: [BankStatementController],
  providers: [BankStatementService],
  exports: [BankStatementService],
})
export class BankStatementModule {}

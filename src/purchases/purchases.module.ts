import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrismaModule, StockModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}

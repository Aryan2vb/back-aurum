import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PdfService } from './utils/pdf.service';
import { InvoiceCalculationService } from './utils/invoice-calculation.service';
import { InvoiceNegotiationService } from './utils/invoice-negotiation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrismaModule, CreditsModule, StockModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, PdfService, InvoiceCalculationService, InvoiceNegotiationService],
  exports: [InvoicesService],
})
export class InvoicesModule {}

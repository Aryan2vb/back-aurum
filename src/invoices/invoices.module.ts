import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PdfService } from './utils/pdf.service';
import { InvoiceCalculationService } from './utils/invoice-calculation.service';
import { InvoiceNegotiationService } from './utils/invoice-negotiation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { FooterLibraryService } from './footer-library.service';
import { FooterLibraryController } from './footer-library.controller';

@Module({
  imports: [PrismaModule, CreditsModule],
  controllers: [InvoicesController, FooterLibraryController],
  providers: [InvoicesService, PdfService, InvoiceCalculationService, InvoiceNegotiationService, FooterLibraryService],
  exports: [InvoicesService],
})
export class InvoicesModule {}

import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PdfService } from './utils/pdf.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
    imports: [PrismaModule, CreditsModule],
    controllers: [InvoicesController],
    providers: [InvoicesService, PdfService],
    exports: [InvoicesService],
})
export class InvoicesModule {}

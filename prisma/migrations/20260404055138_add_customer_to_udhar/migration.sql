-- AddForeignKey
ALTER TABLE "UdharEntry" ADD CONSTRAINT "UdharEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

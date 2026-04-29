-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ACTIVE', 'REPAID', 'CANCELLED', 'OVERDUE');

-- CreateTable Organization
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable Transaction (Partitioned)
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "volumeUSD" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "rawData" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- CreateTable PayoutEvent (Partitioned)
CREATE TABLE "PayoutEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "maintainer" TEXT NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "amountXlm" DECIMAL(65,30) NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutEvent_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- CreateTable IndexerState
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "lastProcessedLedger" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable VerifiedContract
CREATE TABLE "VerifiedContract" (
    "address" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedContract_pkey" PRIMARY KEY ("address")
);

-- CreateTable Invoice
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "faceValue" DECIMAL(65,30) NOT NULL,
    "faceValueUSD" DECIMAL(65,30) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuer" TEXT NOT NULL,
    "holder" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "repaidAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookConfig
CREATE TABLE "WebhookConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookDelivery
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookConfigId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable ApiKey
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "name" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable MaintainerNotification
CREATE TABLE "MaintainerNotification" (
    "walletAddress" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "optIn" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintainerNotification_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateIndex
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");

-- CreateIndex for Transaction
CREATE UNIQUE INDEX "Transaction_txHash_eventIndex_createdAt_key" ON "Transaction"("txHash", "eventIndex", "createdAt");
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");
CREATE INDEX "Transaction_walletAddress_idx" ON "Transaction"("walletAddress");
CREATE INDEX "Transaction_txHash_idx" ON "Transaction"("txHash");
CREATE INDEX "Transaction_ledger_idx" ON "Transaction"("ledger");

-- CreateIndex for PayoutEvent
CREATE INDEX "PayoutEvent_orgId_idx" ON "PayoutEvent"("orgId");
CREATE INDEX "PayoutEvent_maintainer_idx" ON "PayoutEvent"("maintainer");
CREATE INDEX "PayoutEvent_createdAt_idx" ON "PayoutEvent"("createdAt");

-- CreateIndex for others
CREATE INDEX "VerifiedContract_address_idx" ON "VerifiedContract"("address");
CREATE UNIQUE INDEX "Invoice_invoiceId_key" ON "Invoice"("invoiceId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_issuer_idx" ON "Invoice"("issuer");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE UNIQUE INDEX "WebhookConfig_organizationId_key" ON "WebhookConfig"("organizationId");
CREATE INDEX "WebhookConfig_organizationId_idx" ON "WebhookConfig"("organizationId");
CREATE INDEX "WebhookDelivery_webhookConfigId_idx" ON "WebhookDelivery"("webhookConfigId");
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");
CREATE INDEX "ApiKey_isActive_idx" ON "ApiKey"("isActive");
CREATE INDEX "ApiKey_createdAt_idx" ON "ApiKey"("createdAt");
CREATE UNIQUE INDEX "ApiKey_organizationId_hashedKey_key" ON "ApiKey"("organizationId", "hashedKey");
CREATE UNIQUE INDEX "MaintainerNotification_unsubscribeToken_key" ON "MaintainerNotification"("unsubscribeToken");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create monthly partitions for 2024-2027 (Transaction & PayoutEvent)
DO $$
DECLARE
    start_date DATE := '2024-01-01';
    end_date DATE := '2027-01-01';
    curr_date DATE := start_date;
BEGIN
    WHILE curr_date < end_date LOOP
        EXECUTE format('CREATE TABLE IF NOT EXISTS "Transaction_%s_%s" PARTITION OF "Transaction" FOR VALUES FROM (%L) TO (%L)',
            to_char(curr_date, 'YYYY'), to_char(curr_date, 'MM'), curr_date, curr_date + interval '1 month');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS "PayoutEvent_%s_%s" PARTITION OF "PayoutEvent" FOR VALUES FROM (%L) TO (%L)',
            to_char(curr_date, 'YYYY'), to_char(curr_date, 'MM'), curr_date, curr_date + interval '1 month');
            
        curr_date := curr_date + interval '1 month';
    END LOOP;
END $$;

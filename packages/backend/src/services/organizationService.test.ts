import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const mockStellarService = {
  readOrganization: vi.fn(),
  registerOrg: vi.fn(),
  readOrgBudget: vi.fn(),
};

const mockOrganizationRepository = {
  upsert: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
};

vi.mock("../services/cache.js", () => ({
  redis: mockRedis,
}));

vi.mock("../services/stellarService.js", () => ({
  stellarService: mockStellarService,
}));

vi.mock("../repositories/OrganizationRepository.js", () => ({
  organizationRepository: mockOrganizationRepository,
}));

import { organizationService } from "./organizationService.js";

describe("OrganizationService Caching", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getOrganization", () => {
    it("should fetch from stellarService and set Redis cache on cache miss", async () => {
      const orgId = "stellar";
      const orgMockData = {
        id: "stellar",
        name: "Stellar Dev Fund",
        admin: "GB...",
        metadata_cid: "QmCID123",
      };

      mockRedis.get.mockResolvedValueOnce(null);
      mockStellarService.readOrganization.mockResolvedValueOnce(orgMockData);

      const result = await organizationService.getOrganization(orgId);

      expect(mockRedis.get).toHaveBeenCalledWith("org:stellar");
      expect(mockStellarService.readOrganization).toHaveBeenCalledWith("stellar");
      expect(mockRedis.set).toHaveBeenCalledWith(
        "org:stellar",
        JSON.stringify({
          id: "stellar",
          name: "Stellar Dev Fund",
          admin: "GB...",
          metadataCid: "QmCID123",
        }),
        "EX",
        300
      );
      expect(result).toEqual({
        id: "stellar",
        name: "Stellar Dev Fund",
        admin: "GB...",
        metadataCid: "QmCID123",
      });
    });

    it("should retrieve organization details from cache on cache hit", async () => {
      const orgId = "stellar";
      const cachedData = {
        id: "stellar",
        name: "Stellar Dev Fund",
        admin: "GB...",
        metadataCid: "QmCID123",
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await organizationService.getOrganization(orgId);

      expect(mockRedis.get).toHaveBeenCalledWith("org:stellar");
      expect(mockStellarService.readOrganization).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it("should gracefully handle Redis get failures and fallback to stellarService", async () => {
      const orgId = "stellar";
      const orgMockData = {
        id: "stellar",
        name: "Stellar Dev Fund",
        admin: "GB...",
        metadata_cid: "QmCID123",
      };

      mockRedis.get.mockRejectedValueOnce(new Error("Redis connection down"));
      mockStellarService.readOrganization.mockResolvedValueOnce(orgMockData);

      const result = await organizationService.getOrganization(orgId);

      expect(mockRedis.get).toHaveBeenCalledWith("org:stellar");
      expect(mockStellarService.readOrganization).toHaveBeenCalledWith(orgId);
      expect(result).toEqual({
        id: "stellar",
        name: "Stellar Dev Fund",
        admin: "GB...",
        metadataCid: "QmCID123",
      });
    });
  });

  describe("registerOrganization", () => {
    it("should invalidate the cache when organization is successfully registered", async () => {
      const orgId = "stellar";
      mockStellarService.registerOrg.mockResolvedValueOnce({ success: true, transactionHash: "hash" });
      mockOrganizationRepository.upsert.mockResolvedValueOnce({});

      const result = await organizationService.registerOrganization(
        orgId,
        "Stellar Dev Fund",
        "GB...",
        "S..."
      );

      expect(result.success).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith("orgs:page:1:limit:10");
      expect(mockRedis.del).toHaveBeenCalledWith("org:stellar");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEnv, parseDisableSignup } from "./env";
import { ShelfError } from "./error";

// why: Mock isBrowser to ensure we're testing server-side behavior
vi.mock("./is-browser", () => ({
  isBrowser: false,
}));

describe("getEnv", () => {
  beforeEach(() => {
    // why: Clear all env stubs before each test
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    // why: Clean up env stubs after each test
    vi.unstubAllEnvs();
  });

  describe("default behavior (isRequired=true, allowEmpty=false)", () => {
    it("should throw error when env var is not set", () => {
      // why: Explicitly stub as undefined to test missing var case
      vi.stubEnv("ADMIN_EMAIL", undefined);

      expect(() => {
        getEnv("ADMIN_EMAIL");
      }).toThrow(ShelfError);
    });

    it("should throw error when env var is empty string", () => {
      vi.stubEnv("ADMIN_EMAIL", "");

      expect(() => {
        getEnv("ADMIN_EMAIL");
      }).toThrow(ShelfError);
    });

    it("should return value when env var is set", () => {
      vi.stubEnv("ADMIN_EMAIL", "admin@example.com");

      const result = getEnv("ADMIN_EMAIL");

      expect(result).toBe("admin@example.com");
    });
  });

  describe("with allowEmpty=true", () => {
    it("should throw error when env var is not set", () => {
      // why: Test that isRequired defaults to true even with partial options
      vi.stubEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", undefined);

      expect(() => {
        getEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", {
          allowEmpty: true,
          // Note: NOT passing isRequired - should default to true
        });
      }).toThrow(ShelfError);
    });

    it("should allow empty string when env var is set to empty", () => {
      vi.stubEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", "");

      const result = getEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", {
        allowEmpty: true,
      });

      expect(result).toBe("");
    });

    it("should return value when env var is set", () => {
      vi.stubEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", "whsec_test123");

      const result = getEnv("STRIPE_WEBHOOK_ENDPOINT_SECRET", {
        allowEmpty: true,
      });

      expect(result).toBe("whsec_test123");
    });
  });

  describe("with isRequired=false", () => {
    it("should return undefined when env var is not set", () => {
      // why: Explicitly stub as undefined to test missing var case
      vi.stubEnv("DIRECT_URL", undefined);

      const result = getEnv("DIRECT_URL", { isRequired: false });

      expect(result).toBeUndefined();
    });

    it("should return empty string when env var is empty string", () => {
      vi.stubEnv("ADMIN_EMAIL", "");

      const result = getEnv("ADMIN_EMAIL", { isRequired: false });

      expect(result).toBe("");
    });

    it("should return value when env var is set", () => {
      vi.stubEnv("ADMIN_EMAIL", "admin@example.com");

      const result = getEnv("ADMIN_EMAIL", { isRequired: false });

      expect(result).toBe("admin@example.com");
    });
  });

  describe("with allowEmpty=true and isRequired=false", () => {
    it("should return undefined when env var is not set", () => {
      // why: Explicitly stub as undefined to test missing var case
      vi.stubEnv("SMTP_PORT", undefined);

      const result = getEnv("SMTP_PORT", {
        isRequired: false,
        allowEmpty: true,
      });

      expect(result).toBeUndefined();
    });

    it("should return empty string when env var is set to empty", () => {
      vi.stubEnv("SMTP_FROM", "");

      const result = getEnv("SMTP_FROM", {
        isRequired: false,
        allowEmpty: true,
      });

      expect(result).toBe("");
    });

    it("should return value when env var is set", () => {
      vi.stubEnv("SMTP_FROM", "noreply@example.com");

      const result = getEnv("SMTP_FROM", {
        isRequired: false,
        allowEmpty: true,
      });

      expect(result).toBe("noreply@example.com");
    });
  });

  describe("SMTP credentials use case", () => {
    it("should throw error when required var with allowEmpty is missing", () => {
      // why: Matches real usage - only passing allowEmpty, isRequired defaults
      vi.stubEnv("DISABLE_SSO", undefined);

      expect(() => {
        getEnv("DISABLE_SSO", { allowEmpty: true });
      }).toThrow(ShelfError);
      expect(() => {
        getEnv("DISABLE_SSO", { allowEmpty: true });
      }).toThrow("DISABLE_SSO is not set");
    });

    it("should allow empty string when explicitly set (SMTP no-auth case)", () => {
      vi.stubEnv("DISABLE_SSO", "");

      const result = getEnv("DISABLE_SSO", { allowEmpty: true });

      expect(result).toBe("");
    });

    it("should accept actual value when provided", () => {
      vi.stubEnv("DISABLE_SSO", "true");

      const result = getEnv("DISABLE_SSO", { allowEmpty: true });

      expect(result).toBe("true");
    });
  });

  describe("strict validation for critical env vars", () => {
    it("should throw error when DATABASE_URL is empty string", () => {
      vi.stubEnv("DATABASE_URL", "");

      expect(() => {
        getEnv("DATABASE_URL");
      }).toThrow(ShelfError);
      expect(() => {
        getEnv("DATABASE_URL");
      }).toThrow("DATABASE_URL is not set");
    });

    it("should throw error when SESSION_SECRET is empty string", () => {
      vi.stubEnv("SESSION_SECRET", "");

      expect(() => {
        getEnv("SESSION_SECRET");
      }).toThrow(ShelfError);
    });
  });
});

describe("parseDisableSignup", () => {
  // why: this is a security control on a public-facing, invite-only app. The
  // previous `=== "true"` failed OPEN — anything that was not exactly "true"
  // silently allowed strangers to self-register. These pin the inversion.

  it("stays CLOSED when the variable is unset", () => {
    // The failure that mattered: drop the line from render.yaml and, before
    // this change, self-registration quietly came back.
    expect(parseDisableSignup(undefined)).toBe(true);
  });

  it("stays CLOSED for a wrongly-cased or non-boolean value", () => {
    for (const raw of [
      "TRUE",
      "True",
      "1",
      "yes",
      "no",
      "",
      "  ",
      "disabled",
    ]) {
      expect(parseDisableSignup(raw), `for ${JSON.stringify(raw)}`).toBe(true);
    }
  });

  it("stays CLOSED for the explicit true", () => {
    expect(parseDisableSignup("true")).toBe(true);
  });

  it("opens ONLY for an explicit false", () => {
    expect(parseDisableSignup("false")).toBe(false);
    expect(parseDisableSignup("FALSE")).toBe(false);
    expect(parseDisableSignup("  false  ")).toBe(false);
  });
});

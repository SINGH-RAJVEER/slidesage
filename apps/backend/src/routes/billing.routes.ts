import { Hono } from "hono";

const billing = new Hono();

// Billing endpoints have been removed as part of service removal.
// These endpoints are now disabled.

billing.get("/balance", async (c) => {
  return c.json(
    {
      error: {
        message: "Billing service has been removed",
      },
    },
    501,
  );
});

billing.post("/checkout", async (c) => {
  return c.json(
    {
      error: {
        message: "Billing service has been removed",
      },
    },
    501,
  );
});

billing.post("/webhook", async (c) => {
  return c.json(
    {
      error: {
        message: "Billing service has been removed",
      },
    },
    501,
  );
});

export default billing;

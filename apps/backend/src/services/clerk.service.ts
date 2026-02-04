export async function updateClerkPublicMetadata(params: {
  userId: string;
  publicMetadata: Record<string, unknown>;
}): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return;

  const response = await fetch(
    `https://api.clerk.com/v1/users/${params.userId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        public_metadata: params.publicMetadata,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to update Clerk public metadata: ${response.status} ${text}`,
    );
  }
}

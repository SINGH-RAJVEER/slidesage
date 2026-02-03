export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  generate: "/generate",
  presentations: "/presentations",
  presentationById: (presentationId: number | string) =>
    `/presentations/${presentationId}`,
  presentation: "/presentation",
  presentationError: "/presentation-error",
  purchase: "/purchase",
} as const;

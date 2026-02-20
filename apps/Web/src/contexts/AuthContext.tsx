import React, { createContext, useContext, useEffect, useState } from "react";

interface User {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isSignedIn: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isSignedIn: false,
  signOut: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch current user session on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data);
        }
      } catch (error) {
        console.error("Failed to fetch session:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, []);

  const signOut = async () => {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
      // Redirect to sign-in
      window.location.href = "/sign-in";
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSignedIn: user !== null,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

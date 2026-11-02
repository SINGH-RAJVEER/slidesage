package main

import "testing"

func TestDatabaseURLRequiresTLS(t *testing.T) {
	for _, value := range []string{
		"",
		"mysql://user:pass@database.example/slidesage?sslmode=require",
		"postgresql://user:pass@database.example/slidesage",
		"postgresql://user:pass@database.example/slidesage?sslmode=disable",
		"postgresql://user:pass@database.example/slidesage?sslmode=prefer",
		"postgresql://user:pass@database.example/db?sslmode=require&host=other",
		"postgresql://user:pass@database.example/db?sslmode=require&port=5432",
		"postgresql://user:pass@database.example/db?sslmode=require&service=other",
	} {
		if validateDatabaseURL(value) == nil {
			t.Fatalf("accepted unsafe database URL %q", value)
		}
	}
	if err := validateDatabaseURL("postgresql://user:pass@database.example/slidesage?sslmode=require&channel_binding=require"); err != nil {
		t.Fatal(err)
	}
}

package main

import "testing"

func TestRequireLocalDatabase(t *testing.T) {
	allowed := []string{
		"postgresql://slidesage:slidesage@127.0.0.1:5432/slidesage",
		"postgres://slidesage@localhost/slidesage",
		"postgres://slidesage@[::1]:5432/slidesage",
		"host=/run/postgresql dbname=slidesage",
		"host=127.0.0.1,localhost dbname=slidesage",
	}
	for _, databaseURL := range allowed {
		if err := requireLocalDatabase(databaseURL); err != nil {
			t.Errorf("%s: %v", databaseURL, err)
		}
	}

	rejected := []string{
		"postgresql://slidesage:secret@db.example.com:5432/slidesage",
		"postgres://user@10.0.0.5/slidesage",
		"postgres://user@localhost.example.com/slidesage",
		"host=127.0.0.1,prod.example.com dbname=slidesage",
		"postgres://user@127.0.0.1,db.example.com/slidesage",
		"host=34.120.0.1 dbname=slidesage",
		"::not a connection string::",
	}
	for _, databaseURL := range rejected {
		if err := requireLocalDatabase(databaseURL); err == nil {
			t.Errorf("%s: expected a refusal", databaseURL)
		}
	}
}

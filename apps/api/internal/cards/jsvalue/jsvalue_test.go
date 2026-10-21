package jsvalue

import (
	"math"
	"strings"
	"testing"
)

func TestFormatNumberMatchesJavaScript(t *testing.T) {
	cases := map[float64]string{
		0:                     "0",
		math.Copysign(0, -1):  "0",
		1e21:                  "1e+21",
		1.5e-7:                "1.5e-7",
		123456789012345680000: "123456789012345680000",
		0.000001:              "0.000001",
		5e-324:                "5e-324",
		1 << 53:               "9007199254740992",
		-2.5:                  "-2.5",
		0.30000000000000004:   "0.30000000000000004",
		1e12:                  "1000000000000",
		math.Inf(1):           "Infinity",
	}
	for value, want := range cases {
		if got := FormatNumber(value); got != want {
			t.Errorf("FormatNumber(%v) = %q, want %q", value, got, want)
		}
	}
	if got := FormatNumber(math.NaN()); got != "NaN" {
		t.Errorf("NaN = %q", got)
	}
}

func TestRoundMatchesMathRound(t *testing.T) {
	cases := map[float64]float64{2.5: 3, -2.5: -2, 0.49999999999999994: 0, -0.4: 0, 1.4999: 1}
	for value, want := range cases {
		if got := Round(value); got != want {
			t.Errorf("Round(%v) = %v, want %v", value, got, want)
		}
	}
}

func TestParseOrdersKeysAsJavaScriptDoes(t *testing.T) {
	value, err := Parse(`{"b":1,"2":1,"a":1,"1":1,"4294967295":1,"4294967294":1,"01":1,"-1":1,"b":2}`)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(value.Object().Keys(), ",")
	if want := "1,2,4294967294,b,a,4294967295,01,-1"; got != want {
		t.Fatalf("keys = %s, want %s", got, want)
	}
	if value.Get("b").Number() != 2 {
		t.Fatal("a repeated key must keep its last value")
	}
}

func TestParseRejectsWhatJSONParseRejects(t *testing.T) {
	for _, text := range []string{"", "{", "{}{}", "[1,]", "{\"a\":1,}", "01", "1.", ".5", "+1", "'a'", "\"\t\"", "\"\\x\"", "\"\\u12g4\"", "\ufeff{}", "nul", "[1 2]", "{\"a\" 1}"} {
		if _, err := Parse(text); err == nil {
			t.Errorf("Parse(%q) succeeded", text)
		}
	}
	for _, text := range []string{"1e999", "-0", " [ ] ", "\"\\ud800\"", "{\"__proto__\":1}"} {
		if _, err := Parse(text); err != nil {
			t.Errorf("Parse(%q) failed: %v", text, err)
		}
	}
	value, _ := Parse("1e999")
	if !math.IsInf(value.Number(), 1) {
		t.Fatal("1e999 must parse to Infinity")
	}
}

func TestStringifyEscapesOnlyWhatJavaScriptEscapes(t *testing.T) {
	value, err := Parse(`["\u2028\u2029<>&\u007f\u0080\ud800\udc00\udc00\u0001", -0, 1e999, {"a":null}]`)
	if err != nil {
		t.Fatal(err)
	}
	got := string(Stringify(value))
	want := "[\"\u2028\u2029<>&\u007f\u0080\U00010000\\udc00\\u0001\",0,null,{\"a\":null}]"
	if got != want {
		t.Fatalf("Stringify = %q, want %q", got, want)
	}
}

func TestSplitSurrogatesJoinWhenConcatenated(t *testing.T) {
	high, _ := Parse(`"\ud83d"`)
	low, _ := Parse(`"\ude00"`)
	joined := Concat(high.Str(), low.Str())
	if joined != "\U0001f600" || CodePoints(joined) != 1 || Length(joined) != 2 {
		t.Fatalf("joined = %q", joined)
	}
	if CodePoints(high.Str()) != 1 || Length(high.Str()) != 1 {
		t.Fatal("a lone surrogate is one code point and one unit")
	}
}

func TestToStringFollowsStringCoercion(t *testing.T) {
	value, _ := Parse(`[null, [1, [2, "a"]], {"x":1}, true, 1.5]`)
	got, err := ToString(value)
	if err != nil || got != ",1,2,a,[object Object],true,1.5" {
		t.Fatalf("ToString = %q, %v", got, err)
	}
	broken, _ := Parse(`[{"toString":1}]`)
	if _, err := ToString(broken); err == nil {
		t.Fatal("an own toString property must fail coercion")
	}
}

func TestParseNumberMatchesNumber(t *testing.T) {
	cases := map[string]float64{"": 0, " 12 ": 12, "0x10": 16, "1e3": 1000, ".5": 0.5, "5.": 5, "-Infinity": math.Inf(-1)}
	for text, want := range cases {
		if got := ParseNumber(text); got != want {
			t.Errorf("ParseNumber(%q) = %v, want %v", text, got, want)
		}
	}
	for _, text := range []string{"abc", "1,000", "--1", "0x", "1e", "+-1"} {
		if got := ParseNumber(text); got == got {
			t.Errorf("ParseNumber(%q) = %v, want NaN", text, got)
		}
	}
}

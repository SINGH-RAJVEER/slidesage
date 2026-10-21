package jsvalue

import (
	"math"
	"strconv"
	"strings"
)

// FormatNumber is JavaScript's Number::toString with radix 10.
func FormatNumber(value float64) string {
	switch {
	case value != value:
		return "NaN"
	case value == 0:
		return "0"
	case math.IsInf(value, 1):
		return "Infinity"
	case math.IsInf(value, -1):
		return "-Infinity"
	case value < 0:
		return "-" + FormatNumber(-value)
	}
	// The shortest round-tripping digits, as d.ddde±x.
	exponential := strconv.FormatFloat(value, 'e', -1, 64)
	mantissa, exponentText, _ := strings.Cut(exponential, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	exponent, _ := strconv.Atoi(exponentText)
	count := len(digits)
	point := exponent + 1
	switch {
	case count <= point && point <= 21:
		return digits + strings.Repeat("0", point-count)
	case 0 < point && point <= 21:
		return digits[:point] + "." + digits[point:]
	case -6 < point && point <= 0:
		return "0." + strings.Repeat("0", -point) + digits
	}
	sign := "+"
	if point-1 < 0 {
		sign = "-"
	}
	power := strconv.Itoa(abs(point - 1))
	if count == 1 {
		return digits + "e" + sign + power
	}
	return digits[:1] + "." + digits[1:] + "e" + sign + power
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

// Round is Math.round: halves round toward positive infinity.
func Round(value float64) float64 {
	if value != value || math.IsInf(value, 0) || value == 0 {
		return value
	}
	floor := math.Floor(value)
	if value-floor >= 0.5 {
		floor++
	}
	if floor == 0 && value < 0 {
		return math.Copysign(0, -1)
	}
	return floor
}

// IsInteger is Number.isInteger.
func IsInteger(value float64) bool {
	return !math.IsInf(value, 0) && value == value && math.Trunc(value) == value
}

// ParseNumber is Number(text) for a string: trimmed decimal, hexadecimal,
// octal or binary literals, Infinity, and NaN for anything else.
func ParseNumber(text string) float64 {
	text = Trim(text)
	if text == "" {
		return 0
	}
	if len(text) > 2 && text[0] == '0' {
		base := 0
		switch text[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			result := 0.0
			for _, char := range text[2:] {
				digit := digitValue(char)
				if digit < 0 || digit >= base {
					return math.NaN()
				}
				result = result*float64(base) + float64(digit)
			}
			return result
		}
	}
	unsigned := strings.TrimLeft(text, "+-")
	if len(text)-len(unsigned) > 1 {
		return math.NaN()
	}
	if unsigned == "Infinity" {
		if text[0] == '-' {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	if !decimalLiteral(unsigned) {
		return math.NaN()
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil && !isRangeError(err) {
		return math.NaN()
	}
	return value
}

func digitValue(char rune) int {
	switch {
	case char >= '0' && char <= '9':
		return int(char - '0')
	case char >= 'a' && char <= 'z':
		return int(char-'a') + 10
	case char >= 'A' && char <= 'Z':
		return int(char-'A') + 10
	}
	return -1
}

// decimalLiteral matches StrUnsignedDecimalLiteral: digits with an optional
// point and exponent, where a point needs digits on at least one side.
func decimalLiteral(text string) bool {
	index := 0
	whole := 0
	for index < len(text) && text[index] >= '0' && text[index] <= '9' {
		index++
		whole++
	}
	fraction := 0
	if index < len(text) && text[index] == '.' {
		index++
		for index < len(text) && text[index] >= '0' && text[index] <= '9' {
			index++
			fraction++
		}
	}
	if whole == 0 && fraction == 0 {
		return false
	}
	if index < len(text) && (text[index] == 'e' || text[index] == 'E') {
		index++
		if index < len(text) && (text[index] == '+' || text[index] == '-') {
			index++
		}
		digits := 0
		for index < len(text) && text[index] >= '0' && text[index] <= '9' {
			index++
			digits++
		}
		if digits == 0 {
			return false
		}
	}
	return index == len(text)
}

func isRangeError(err error) bool {
	numberError, ok := err.(*strconv.NumError)
	return ok && numberError.Err == strconv.ErrRange
}

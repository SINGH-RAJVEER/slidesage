package carddocument

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"unicode/utf8"
)

// validateJSONB checks raw tokens without decoding or rewriting them. Go's JSON
// decoder replaces invalid UTF-8 and unpaired surrogates, whereas PostgreSQL's
// UTF-8 JSONB input rejects them. Every key and value, including duplicate keys,
// must be compatible before PostgreSQL discards any duplicate keys.
func validateJSONB(body []byte) error {
	if !utf8.Valid(body) {
		return fmt.Errorf("JSONB compatibility: invalid UTF-8")
	}
	if !json.Valid(body) {
		return fmt.Errorf("JSONB compatibility: invalid JSON")
	}
	for i := 0; i < len(body); i++ {
		if body[i] == '"' {
			for i++; body[i] != '"'; i++ {
				if body[i] != '\\' {
					continue
				}
				start := i
				i++
				if body[i] != 'u' {
					continue // Includes escaped backslashes and quotes.
				}
				code, _ := strconv.ParseUint(string(body[i+1:i+5]), 16, 16)
				i += 4
				switch {
				case code == 0:
					return fmt.Errorf("JSONB compatibility at byte %d: NUL Unicode escape is not supported", start)
				case code >= 0xd800 && code <= 0xdbff:
					if i+6 >= len(body) || body[i+1] != '\\' || body[i+2] != 'u' {
						return fmt.Errorf("JSONB compatibility at byte %d: unpaired high surrogate", start)
					}
					low, _ := strconv.ParseUint(string(body[i+3:i+7]), 16, 16)
					if low < 0xdc00 || low > 0xdfff {
						return fmt.Errorf("JSONB compatibility at byte %d: unpaired high surrogate", start)
					}
					i += 6
				case code >= 0xdc00 && code <= 0xdfff:
					return fmt.Errorf("JSONB compatibility at byte %d: unpaired low surrogate", start)
				}
			}
		} else if body[i] == '-' || body[i] >= '0' && body[i] <= '9' {
			start := i
			for i < len(body) && bytes.IndexByte([]byte("0123456789.eE+-"), body[i]) >= 0 {
				i++
			}
			if err := validateJSONBNumber(body[start:i]); err != nil {
				return fmt.Errorf("JSONB compatibility at byte %d: %w", start, err)
			}
			i--
		}
	}
	return nil
}

// JSONB uses unconstrained PostgreSQL numeric: at most 131072 significant
// digits before the decimal point and a display scale of at most 16383.
// Check lexical precision/scale without float rounding or expanding exponents.
func validateJSONBNumber(number []byte) error {
	if number[0] == '-' {
		number = number[1:]
	}
	var exponent int64
	if index := bytes.IndexAny(number, "eE"); index >= 0 {
		var err error
		exponent, err = strconv.ParseInt(string(number[index+1:]), 10, 64)
		// PostgreSQL also bounds the input exponent, even for zero.
		if err != nil || exponent > 1073741823 || exponent < -1073741823 {
			return fmt.Errorf("number exponent exceeds PostgreSQL numeric limits")
		}
		number = number[:index]
	}
	integerDigits := len(number)
	scale := 0
	if index := bytes.IndexByte(number, '.'); index >= 0 {
		integerDigits = index
		scale = len(number) - index - 1
	}
	if int64(scale)-exponent > 16383 {
		return fmt.Errorf("number exceeds PostgreSQL numeric fractional scale limit of 16383")
	}
	leadingZeros := 0
	for _, digit := range number {
		if digit == '.' {
			continue
		}
		if digit != '0' {
			if int64(integerDigits-leadingZeros)+exponent > 131072 {
				return fmt.Errorf("number exceeds PostgreSQL numeric integer digit limit of 131072")
			}
			break
		}
		leadingZeros++
	}
	return nil
}

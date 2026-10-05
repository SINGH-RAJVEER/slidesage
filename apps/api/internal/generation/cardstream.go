package generation

import (
	"encoding/json"
	"strings"
)

// cardStream picks each element of a drafting answer's "cards" array out of
// the streamed text as soon as the model closes it, so a card can be shown
// before the rest of its batch is written. It only tracks enough JSON
// structure to find those elements; the finished answer is still decoded in
// full, and anything the stream missed is handled from that.
type cardStream struct {
	emit func(json.RawMessage)

	// lead holds the text before the answer object, where an inline <think>
	// block may contain braces of its own.
	lead     strings.Builder
	started  bool
	finished bool

	depth    int
	inString bool
	escaped  bool
	// key is the last string closed directly inside the answer object; an
	// array opened after it is the "cards" array when it reads cards.
	key     strings.Builder
	keying  bool
	inCards bool
	card    []byte
}

func newCardStream(emit func(json.RawMessage)) *cardStream {
	return &cardStream{emit: emit}
}

func (s *cardStream) write(delta string) {
	for index := 0; index < len(delta) && !s.finished; index++ {
		s.step(delta[index])
	}
}

func (s *cardStream) step(c byte) {
	if !s.started {
		if c != '{' || strings.Count(s.lead.String(), "<think>") > strings.Count(s.lead.String(), "</think>") {
			s.lead.WriteByte(c)
			return
		}
		s.started = true
	}
	if s.card != nil {
		s.card = append(s.card, c)
	}
	if s.inString {
		switch {
		case s.escaped:
			s.escaped = false
		case c == '\\':
			s.escaped = true
		case c == '"':
			s.inString = false
			s.keying = false
			return
		}
		if s.keying {
			s.key.WriteByte(c)
		}
		return
	}
	switch c {
	case '"':
		s.inString = true
		if s.depth == 1 {
			s.key.Reset()
			s.keying = true
		}
	case '{', '[':
		s.depth++
		if c == '[' && s.depth == 2 && s.key.String() == "cards" {
			s.inCards = true
		}
		if c == '{' && s.inCards && s.depth == 3 {
			s.card = []byte{c}
		}
	case '}', ']':
		if c == '}' && s.inCards && s.depth == 3 && s.card != nil {
			s.emit(s.card)
			s.card = nil
		}
		s.depth--
		if s.depth <= 1 {
			s.inCards = false
		}
		if s.depth <= 0 {
			s.finished = true
		}
	}
}

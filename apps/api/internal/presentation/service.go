package presentation

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/SINGH-RAJVEER/SlideSage/apps/api/internal/cache"
)

type Service struct {
	repository *Repository
	cache      cache.Store
}

func (s *Service) WithCache(store cache.Store) *Service {
	s.cache = store
	return s
}

type cachedList struct {
	Summaries []PresentationSummary
	Total     int
	HasMore   bool
}

func NewService(repository *Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]PresentationSummary, int, bool, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, false, errors.New("invalid presentation pagination")
	}
	var key string
	if s.cache != nil {
		// Read the generation from PostgreSQL on every request. Trigger updates are
		// transactional, including worker writes. A late fill keeps its old key.
		version, err := s.repository.CacheVersion(ctx, userID)
		if err == nil {
			key = cache.Key("presentation-list", userID, strconv.FormatInt(version, 10), strconv.Itoa(limit), strconv.Itoa(offset))
			if value, hit := s.cache.Get(ctx, key); hit {
				var list cachedList
				if json.Unmarshal(value, &list) == nil && list.Summaries != nil {
					return list.Summaries, list.Total, list.HasMore, nil
				}
			}
		}
	}
	page, err := s.repository.ListByUserID(ctx, userID, limit, offset)
	if err != nil {
		return nil, 0, false, err
	}
	summaries := make([]PresentationSummary, 0, len(page.Presentations))
	for _, presentation := range page.Presentations {
		summaries = append(summaries, presentationSummary(presentation))
	}
	if key != "" {
		if value, err := json.Marshal(cachedList{summaries, page.Total, page.HasMore}); err == nil {
			s.cache.Set(ctx, key, value, 30*time.Second)
		}
	}
	return summaries, page.Total, page.HasMore, nil
}

func (s *Service) Detail(ctx context.Context, presentationID, userID string) (PresentationDetail, error) {
	presentation, err := s.repository.FindByID(ctx, presentationID)
	if err != nil {
		return PresentationDetail{}, err
	}
	if presentation.UserID != userID {
		return PresentationDetail{}, ErrUnauthorized
	}
	return PresentationDetail{ID: presentation.ID, Title: presentation.Title, Prompt: presentation.Prompt,
		SlidesData: presentation.SlidesData, CreatedAt: presentation.CreatedAt, UpdatedAt: presentation.UpdatedAt}, nil
}

func (s *Service) Delete(ctx context.Context, presentationID, userID string) error {
	if presentationID == "" || userID == "" {
		return errors.New("presentation ID and user ID are required")
	}
	return s.repository.DeleteOwned(ctx, presentationID, userID)
}

func presentationSummary(presentation Presentation) PresentationSummary {
	var document struct {
		TotalSlides int               `json:"totalSlides"`
		Status      string            `json:"status"`
		Sources     []json.RawMessage `json:"sources"`
		Failure     struct {
			Retry struct {
				ResearchPayload struct {
					Sources []json.RawMessage `json:"sources"`
				} `json:"research_payload"`
			} `json:"retry"`
		} `json:"failure"`
	}
	_ = json.Unmarshal(presentation.SlidesData, &document)
	status := document.Status
	if status != "failed" && status != "generating" {
		status = "ready"
	}
	hasResearch := len(document.Sources) > 0
	if status == "failed" {
		hasResearch = len(document.Failure.Retry.ResearchPayload.Sources) > 0
	}
	return PresentationSummary{ID: presentation.ID, Title: presentation.Title, Prompt: presentation.Prompt,
		SlideCount: document.TotalSlides, Status: status, HasResearch: hasResearch,
		CreatedAt: presentation.CreatedAt, UpdatedAt: presentation.UpdatedAt}
}

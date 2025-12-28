import React, { useEffect, useRef } from 'react';
import { AVAILABLE_TEMPLATES } from '@/types/template';

interface TemplateApplierProps {
  templateId: string;
  children: React.ReactNode;
  className?: string;
}

const TemplateApplier: React.FC<TemplateApplierProps> = ({
  templateId,
  children,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const template = AVAILABLE_TEMPLATES.find(t => t.id === templateId);
    if (!template || !containerRef.current) return;

    const container = containerRef.current;
    const styles = template.styles;

    // Apply styles to elements with specific IDs
    const applyStyles = (id: string, elementStyles: React.CSSProperties) => {
      const elements = container.querySelectorAll(`#${id}`);
      elements.forEach((element) => {
        const htmlElement = element as HTMLElement;
        Object.assign(htmlElement.style, elementStyles);
      });
    };

    // Apply all template styles
    applyStyles('slide-content', {
      ...styles.slideContent,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
    });
    applyStyles('slide-title', styles.slideTitle);
    applyStyles('slide-subtitle', styles.slideSubtitle);
    applyStyles('slide-list', styles.slideList);
    applyStyles('slide-table', styles.slideTable);
    applyStyles('slide-quote', styles.slideQuote);
    applyStyles('slide-description', styles.slideDescription);
    applyStyles('slide-highlight', styles.slideHighlight);
    applyStyles('slide-stats', styles.slideStats);
    applyStyles('slide-keypoint', styles.slideKeypoint);
    applyStyles('slide-image', styles.slideImage);

    // Apply table-specific styles
    const tables = container.querySelectorAll('#slide-table');
    tables.forEach((table) => {
      const ths = table.querySelectorAll('th');
      const tds = table.querySelectorAll('td');
      
      ths.forEach((th) => {
        Object.assign((th as HTMLElement).style, styles.slideTableTh);
      });
      
      tds.forEach((td) => {
        Object.assign((td as HTMLElement).style, styles.slideTableTd);
      });
    });

  }, [templateId, children]);

  const template = AVAILABLE_TEMPLATES.find(t => t.id === templateId);

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full ${template?.backgroundClass || ''} ${className}`}
    >
      {children}
    </div>
  );
};

export default TemplateApplier;
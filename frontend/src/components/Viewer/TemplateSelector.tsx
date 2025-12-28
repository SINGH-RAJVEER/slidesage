import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Check, Sparkles } from 'lucide-react';
import { AVAILABLE_TEMPLATES } from '@/types/template';

interface TemplateSelectorProps {
  selectedTemplate: string;
  onTemplateChange: (templateId: string) => void;
  className?: string;
}

const getTemplatePreviewColors = (templateId: string) => {
  const colorMap: Record<string, { primary: string; secondary: string; accent: string }> = {
    'modern-dark': { primary: 'bg-slate-800', secondary: 'bg-blue-500', accent: 'bg-slate-600' },
    'corporate-blue': { primary: 'bg-blue-600', secondary: 'bg-white', accent: 'bg-slate-200' },
    'minimalist': { primary: 'bg-white', secondary: 'bg-gray-100', accent: 'bg-gray-300' },
    'gradient-purple': { primary: 'bg-purple-600', secondary: 'bg-pink-500', accent: 'bg-indigo-500' },
    'nature-green': { primary: 'bg-green-600', secondary: 'bg-emerald-400', accent: 'bg-lime-500' },
  };
  
  return colorMap[templateId] || colorMap['corporate-blue'];
};

const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplate,
  onTemplateChange,
  className = "",
}) => {
  const currentTemplate = AVAILABLE_TEMPLATES.find(
    t => t.id === selectedTemplate
  );

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline"
            className="w-52 bg-white/10 border-white/20 text-white hover:bg-white/20 justify-between"
          >
            <div className="flex items-center gap-2">
              {/* Current template preview */}
              {currentTemplate && (
                <div className="flex gap-1">
                  {Object.values(getTemplatePreviewColors(currentTemplate.id)).map((color, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full ${color}`} />
                  ))}
                </div>
              )}
              <span className="truncate">
                {currentTemplate?.name || 'Select Template'}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        
        <DropdownMenuContent 
          className="w-72 bg-gray-800/95 backdrop-blur-md border-gray-600"
          align="start"
        >
          <DropdownMenuLabel className="text-white/90 font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Choose Template
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-gray-600" />
          
          {AVAILABLE_TEMPLATES.map((template) => {
            const colors = getTemplatePreviewColors(template.id);
            const isSelected = selectedTemplate === template.id;
            
            return (
              <DropdownMenuItem
                key={template.id}
                onClick={() => onTemplateChange(template.id)}
                className={`
                  text-white hover:bg-gray-700/50 focus:bg-gray-700/50 cursor-pointer p-4
                  ${isSelected ? 'bg-gray-700/30' : ''}
                `}
              >
                <div className="flex items-center gap-3 w-full">
                  {/* Template preview */}
                  <div className="flex-shrink-0">
                    <div className="w-8 h-6 rounded border border-gray-600 overflow-hidden flex">
                      <div className={`w-1/3 ${colors.primary}`} />
                      <div className={`w-1/3 ${colors.secondary}`} />
                      <div className={`w-1/3 ${colors.accent}`} />
                    </div>
                  </div>
                  
                  {/* Template info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {template.name}
                      </span>
                      {isSelected && (
                        <Badge 
                          variant="secondary" 
                          className="bg-blue-500/20 text-blue-300 text-xs"
                        >
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {template.description}
                    </div>
                  </div>
                  
                  {/* Check mark */}
                  {isSelected && (
                    <Check className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default TemplateSelector;
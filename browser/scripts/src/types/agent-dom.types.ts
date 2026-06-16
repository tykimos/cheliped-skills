/**
 * A single element in the Agent DOM output.
 * Carries a sequential ID for agent interaction.
 */
export interface AgentDomNode {
  id: number;
  text?: string;
  placeholder?: string;
  href?: string;
  src?: string;
  name?: string;
  value?: string;
  type?: string;
  tag?: string;
  attributes?: Record<string, string>;
}

/**
 * The complete Agent DOM representation.
 * Grouped by element type to match PRD format.
 */
export interface AgentDom {
  url: string;
  title: string;
  buttons?: AgentDomNode[];
  links?: AgentDomNode[];
  inputs?: AgentDomNode[];
  selects?: AgentDomNode[];
  textareas?: AgentDomNode[];
  forms?: AgentDomNode[];
  texts?: AgentDomNode[];
  images?: AgentDomNode[];
  timestamp: number;
}

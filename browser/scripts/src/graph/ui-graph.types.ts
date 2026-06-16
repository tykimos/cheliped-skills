export type UINodeType = 'button' | 'link' | 'input' | 'form' | 'text' | 'image' | 'select' | 'textarea';

export type UIEdgeRelation =
  | 'submits'
  | 'contains'
  | 'navigates_to'
  | 'labels'
  | 'triggers'
  | 'next_in_form'
  | 'groups';

export interface UIGraphNode {
  id: number;
  type: UINodeType;
  label: string;
  backendNodeId: number;
  properties: Record<string, string>;
}

export interface UIGraphEdge {
  source: number;
  target: number;
  relation: UIEdgeRelation;
  metadata?: Record<string, string>;
}

export interface UIFormGroup {
  formId: number;
  action?: string;
  method?: string;
  inputs: number[];
  submitButton?: number;
}

export interface UIGraph {
  url: string;
  title: string;
  nodes: UIGraphNode[];
  edges: UIGraphEdge[];
  forms: UIFormGroup[];
  timestamp: number;
}

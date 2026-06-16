export interface ActionParam {
  name: string;
  nodeId: number;
  type: 'text' | 'password' | 'email' | 'select' | 'checkbox' | 'radio' | 'file';
  required: boolean;
  placeholder?: string;
  currentValue?: string;
}

export type SemanticActionType =
  | 'submit_form'
  | 'search'
  | 'login'
  | 'navigate'
  | 'open_link'
  | 'click_button'
  | 'fill_input'
  | 'select_option';

export interface SemanticAction {
  id: string;
  type: SemanticActionType;
  label: string;
  params: ActionParam[];
  triggerNodeId: number;
  confidence: number;
}

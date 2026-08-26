export interface AuthorizationInputCallbacks {
  readonly onEnter: () => void | Promise<void>;
  readonly onCancel: () => void;
}

export interface AuthorizationInputSession {
  readonly close: () => void;
}

export interface AuthorizationInputController {
  readonly start: (callbacks: AuthorizationInputCallbacks) => AuthorizationInputSession;
}

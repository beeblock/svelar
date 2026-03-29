export {
  AuthManager,
  AuthenticateMiddleware,
  RequireAuthMiddleware,
  RedirectIfNotAuthenticated,
  guardAuth,
  signJwt,
  verifyJwt,
  type AuthConfig,
  type AuthUser,
  type GuardType,
  type JwtConfig,
  type JwtPayload,
  type JwtTokenPair,
  type TokenConfig,
} from './Auth.js';

export {
  Gate,
  Policy,
  GateResponse,
  AuthorizationError,
  GateMiddleware,
  UserGate,
  type GateCallback,
  type BeforeCallback,
  type AfterCallback,
} from './Gate.js';

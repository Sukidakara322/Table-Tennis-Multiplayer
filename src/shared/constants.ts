/**
 * World units are metres. Origin is the centre of the table surface, y points up.
 * Player 0 stands at +z, player 1 at -z.
 */

// Table (ITTF dimensions)
export const TABLE_LENGTH = 2.74;
export const TABLE_WIDTH = 1.525;
export const HALF_LENGTH = TABLE_LENGTH / 2;
export const HALF_WIDTH = TABLE_WIDTH / 2;
export const TABLE_HEIGHT = 0.76;
export const TABLE_THICKNESS = 0.03;
export const FLOOR_Y = -TABLE_HEIGHT;
export const NET_HEIGHT = 0.1525;
export const NET_HALF_SPAN = HALF_WIDTH + 0.1525;
export const NET_CORD_RADIUS = 0.005;

// Ball
export const BALL_RADIUS = 0.02;

// Simulation
export const PHYSICS_HZ = 240;
export const DT = 1 / PHYSICS_HZ;
export const MAX_SUBSTEPS = 32;

// Forces. Only + - * / and sqrt are used in the step so results match across JS engines.
export const GRAVITY = 9.81;
/** Air drag: a = -DRAG_K * |v| * v */
export const DRAG_K = 0.11;
/** Magnus effect: a = MAGNUS_K * (spin × v) */
export const MAGNUS_K = 0.0035;
/** Per-step spin decay, roughly 10% per second. */
export const SPIN_DAMPING = 0.99958;
export const MAX_SPIN = 600;

// Contacts
export const TABLE_RESTITUTION = 0.9;
export const TABLE_FRICTION = 0.45;
export const FLOOR_RESTITUTION = 0.55;
export const FLOOR_FRICTION = 0.8;
export const NET_CORD_RESTITUTION = 0.35;
export const NET_BODY_RESTITUTION = 0.12;
/** Impacts slower than this settle the ball instead of bouncing (and emit no event). */
export const REST_SPEED = 0.15;

// Paddle zone, expressed in a player's local frame (own end of the table at +z)
export const PADDLE_HIT_RADIUS = 0.13;
export const PADDLE_VISUAL_RADIUS = 0.078;
export const PADDLE_X_LIMIT = 1.5;
export const PADDLE_Y_MAX = 1.0;
export const PADDLE_Y_MIN_OVER_TABLE = 0.03;
export const PADDLE_Y_MIN_BEHIND_TABLE = -0.3;
export const SERVE_Z = HALF_LENGTH + 0.22;
export const READY_Z = HALF_LENGTH + 0.35;
export const MIN_PADDLE_Z = 0.22;
export const MAX_PADDLE_Z = HALF_LENGTH + 0.6;
export const PADDLE_DEPTH_SPEED = 6;

// Serve
/** Launch speed of the serve toss: rises ~0.46 m above the hand (ITTF minimum is 0.16 m). */
export const TOSS_SPEED = 3.0;
export const TOSS_HEIGHT_ABOVE_PADDLE = 0.1;
export const TOSS_Z_IN_FRONT_OF_PADDLE = 0.05;

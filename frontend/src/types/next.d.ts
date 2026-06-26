declare module "next/server" {
  export class NextRequest extends Request {
    // NextRequest custom properties can be added here if needed
  }
  export class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit): NextResponse;
  }
}

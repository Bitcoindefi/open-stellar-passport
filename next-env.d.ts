declare module "next/server" {
  export class NextResponse extends Response {
    static json(body: any, init?: ResponseInit): NextResponse;
  }
  export class NextRequest extends Request {
    url: string;
    nextUrl: URL;
  }
}

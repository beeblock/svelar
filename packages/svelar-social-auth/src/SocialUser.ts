import type { SocialUser as ISocialUser } from './types.js';

export class SocialUser implements ISocialUser {
  public readonly id: string;
  public readonly name: string;
  public readonly email: string | null;
  public readonly avatar: string | null;
  public readonly provider: string;
  public readonly accessToken: string;
  public readonly refreshToken: string | null;
  public readonly expiresIn: number | null;
  public readonly raw: Record<string, unknown>;

  constructor(data: ISocialUser) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email;
    this.avatar = data.avatar;
    this.provider = data.provider;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.expiresIn = data.expiresIn;
    this.raw = data.raw;
  }

  toJSON(): ISocialUser {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      avatar: this.avatar,
      provider: this.provider,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresIn: this.expiresIn,
      raw: this.raw,
    };
  }
}

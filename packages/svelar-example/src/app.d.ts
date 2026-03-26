/// <reference types="@sveltejs/kit" />

declare namespace App {
  interface Locals {
    session: import('svelar/session').Session;
    user: any | null;
    auth: import('svelar/auth').AuthManager;
  }
}

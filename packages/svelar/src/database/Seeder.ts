/**
 * Svelar Database Seeder
 */

export abstract class Seeder {
  /** Run the seeder */
  abstract run(): Promise<void>;

  /** Call another seeder */
  protected async call(SeederClass: new () => Seeder): Promise<void> {
    const seeder = new SeederClass();
    await seeder.run();
  }
}

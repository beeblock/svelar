import { Resource } from '@beeblock/svelar/routing';
import type { SubscriptionPlan } from '../SubscriptionPlan.js';

export interface PlanData {
  id: number;
  name: string;
  stripePriceId: string;
  stripeProductId: string;
  price: number;
  currency: string;
  interval: string;
  intervalCount: number;
  trialDays: number;
  features: string[];
  sortOrder: number;
  active: boolean;
  formattedPrice: string;
  intervalLabel: string;
  trialLabel: string;
  monthlyPrice: number;
  yearlyPrice: number;
}

export class PlanResource extends Resource<SubscriptionPlan, PlanData> {
  toJSON(): PlanData {
    const plan = this.data;
    return {
      id: (plan as any).id,
      name: (plan as any).name,
      stripePriceId: (plan as any).stripe_price_id,
      stripeProductId: (plan as any).stripe_product_id,
      price: (plan as any).price,
      currency: (plan as any).currency,
      interval: (plan as any).interval,
      intervalCount: (plan as any).interval_count,
      trialDays: (plan as any).trial_days,
      features: plan.getFeatures(),
      sortOrder: (plan as any).sort_order,
      active: plan.isActive(),
      formattedPrice: plan.formattedPrice(),
      intervalLabel: plan.intervalLabel(),
      trialLabel: plan.trialLabel(),
      monthlyPrice: plan.monthlyPrice(),
      yearlyPrice: plan.yearlyPrice(),
    };
  }
}

// @ts-nocheck
import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import {
  PaymentProviderError,
  PaymentProviderSessionResponse,
  PaymentSessionStatus,
  CreatePaymentProviderSession,
  UpdatePaymentProviderSession,
  WebhookActionData,
} from "@medusajs/framework/types"

type MtnMomoOptions = {
  api_key: string
  subscription_key: string
  environment: "sandbox" | "production"
  callback_url: string
}

type MtnMomoPaymentData = {
  phone_number: string
  reference_id: string
}

export default class MtnMomoPaymentProvider extends AbstractPaymentProvider<MtnMomoOptions> {
  static identifier = "mtn-momo"

  protected readonly options_: MtnMomoOptions
  protected readonly baseUrl: string

  constructor(container, options) {
    super(container, options)

    this.options_ = {
      api_key: options.api_key || process.env.MTN_MOMO_API_KEY,
      subscription_key: options.subscription_key || process.env.MTN_MOMO_SUBSCRIPTION_KEY,
      environment: options.environment || process.env.MTN_MOMO_ENVIRONMENT || "sandbox",
      callback_url: options.callback_url || process.env.MTN_MOMO_CALLBACK_URL,
    }

    this.baseUrl =
      this.options_.environment === "sandbox"
        ? "https://sandbox.momodeveloper.mtn.com"
        : "https://api.mtn.com"
  }

  /**
   * Initiate payment - send USSD push to customer
   */
  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    try {
      const { amount, currency_code, context: paymentContext } = context
      const phone_number = paymentContext.phone_number

      if (!phone_number) {
        return {
          error: "Phone number is required for Mobile Money payment",
          code: "invalid_data",
          detail: "phone_number missing from context",
        }
      }

      // Generate unique reference ID
      const reference_id = this.generateReferenceId()

      // Get access token
      const access_token = await this.getAccessToken()

      // Initiate collection request
      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${access_token}`,
            "X-Reference-Id": reference_id,
            "X-Target-Environment": this.options_.environment,
            "Ocp-Apim-Subscription-Key": this.options_.subscription_key,
          },
          body: JSON.stringify({
            amount: amount.toString(),
            currency: currency_code || "ZMW",
            externalId: context.context.order_id || reference_id,
            payer: {
              partyIdType: "MSISDN",
              partyId: phone_number.replace("+", ""),
            },
            payerMessage: "Payment for Retail OS order",
            payeeNote: `Order ${context.context.order_id || reference_id}`,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        return {
          error: "Failed to initiate MTN MoMo payment",
          code: "payment_initiation_failed",
          detail: JSON.stringify(error),
        }
      }

      return {
        data: {
          reference_id,
          phone_number,
          status: "pending",
        },
      }
    } catch (error) {
      return {
        error: "MTN MoMo payment error",
        code: "payment_error",
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Authorize payment - check status
   */
  async authorizePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    try {
      const { reference_id } = context.data as MtnMomoPaymentData

      const status = await this.checkPaymentStatus(reference_id)

      return {
        data: {
          ...context.data,
          status,
        },
      }
    } catch (error) {
      return {
        error: "Failed to authorize MTN MoMo payment",
        code: "authorization_error",
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Capture payment - finalize
   */
  async capturePayment(
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    // MTN MoMo captures immediately
    return context
  }

  /**
   * Cancel payment
   */
  async cancelPayment(
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    // MTN MoMo doesn't support cancellation after initiation
    return context
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(
    context: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    try {
      const { reference_id } = context as MtnMomoPaymentData

      const status = await this.checkPaymentStatus(reference_id)

      switch (status) {
        case "SUCCESSFUL":
          return PaymentSessionStatus.AUTHORIZED
        case "FAILED":
          return PaymentSessionStatus.ERROR
        case "PENDING":
        default:
          return PaymentSessionStatus.PENDING
      }
    } catch (error) {
      return PaymentSessionStatus.ERROR
    }
  }

  /**
   * Handle webhook from MTN MoMo
   */
  async getWebhookActionAndData(
    data: Record<string, unknown>
  ): Promise<WebhookActionData> {
    const { status, externalId } = data as any

    switch (status) {
      case "SUCCESSFUL":
        return {
          action: "authorized",
          data: {
            session_id: externalId,
            amount: data.amount,
          },
        }
      case "FAILED":
        return {
          action: "failed",
          data: {
            session_id: externalId,
            error: data.reason || "Payment failed",
          },
        }
      default:
        return {
          action: "not_supported",
        }
    }
  }

  /**
   * Get access token from MTN MoMo API
   */
  private async getAccessToken(): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/collection/token/`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${Buffer.from(
            `${this.options_.api_key}:${this.options_.api_key}`
          ).toString("base64")}`,
          "Ocp-Apim-Subscription-Key": this.options_.subscription_key,
        },
      }
    )

    if (!response.ok) {
      throw new Error("Failed to get MTN MoMo access token")
    }

    const data = await response.json()
    return data.access_token
  }

  /**
   * Check payment status
   */
  private async checkPaymentStatus(reference_id: string): Promise<string> {
    const access_token = await this.getAccessToken()

    const response = await fetch(
      `${this.baseUrl}/collection/v1_0/requesttopay/${reference_id}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${access_token}`,
          "X-Target-Environment": this.options_.environment,
          "Ocp-Apim-Subscription-Key": this.options_.subscription_key,
        },
      }
    )

    if (!response.ok) {
      throw new Error("Failed to check payment status")
    }

    const data = await response.json()
    return data.status
  }

  /**
   * Generate unique reference ID
   */
  private generateReferenceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`
  }
}

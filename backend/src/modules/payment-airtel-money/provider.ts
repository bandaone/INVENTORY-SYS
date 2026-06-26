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

type AirtelMoneyOptions = {
  client_id: string
  client_secret: string
  environment: "sandbox" | "production"
  callback_url: string
}

type AirtelMoneyPaymentData = {
  phone_number: string
  transaction_id: string
}

export default class AirtelMoneyPaymentProvider extends AbstractPaymentProvider<AirtelMoneyOptions> {
  static identifier = "airtel-money"

  protected readonly options_: AirtelMoneyOptions
  protected readonly baseUrl: string

  constructor(container, options) {
    super(container, options)

    this.options_ = {
      client_id: options.client_id || process.env.AIRTEL_CLIENT_ID,
      client_secret: options.client_secret || process.env.AIRTEL_CLIENT_SECRET,
      environment: options.environment || process.env.AIRTEL_ENVIRONMENT || "sandbox",
      callback_url: options.callback_url || process.env.AIRTEL_CALLBACK_URL,
    }

    this.baseUrl =
      this.options_.environment === "sandbox"
        ? "https://openapiuat.airtel.africa"
        : "https://openapi.airtel.africa"
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
          error: "Phone number is required for Airtel Money payment",
          code: "invalid_data",
          detail: "phone_number missing from context",
        }
      }

      // Get access token
      const access_token = await this.getAccessToken()

      // Initiate collection request
      const transaction_id = this.generateTransactionId()

      const response = await fetch(
        `${this.baseUrl}/merchant/v1/payments/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${access_token}`,
            "X-Country": "ZM",
            "X-Currency": currency_code || "ZMW",
          },
          body: JSON.stringify({
            reference: transaction_id,
            subscriber: {
              country: "ZM",
              currency: currency_code || "ZMW",
              msisdn: phone_number.replace("+", ""),
            },
            transaction: {
              amount: amount,
              country: "ZM",
              currency: currency_code || "ZMW",
              id: transaction_id,
            },
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        return {
          error: "Failed to initiate Airtel Money payment",
          code: "payment_initiation_failed",
          detail: JSON.stringify(error),
        }
      }

      const data = await response.json()

      return {
        data: {
          transaction_id,
          phone_number,
          status: "pending",
          airtel_transaction_id: data.data?.transaction?.id,
        },
      }
    } catch (error) {
      return {
        error: "Airtel Money payment error",
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
      const { transaction_id } = context.data as AirtelMoneyPaymentData

      const status = await this.checkPaymentStatus(transaction_id)

      return {
        data: {
          ...context.data,
          status,
        },
      }
    } catch (error) {
      return {
        error: "Failed to authorize Airtel Money payment",
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
    // Airtel Money captures immediately
    return context
  }

  /**
   * Cancel payment
   */
  async cancelPayment(
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    // Airtel Money doesn't support cancellation after initiation
    return context
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(
    context: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    try {
      const { transaction_id } = context as AirtelMoneyPaymentData

      const status = await this.checkPaymentStatus(transaction_id)

      switch (status) {
        case "SUCCESS":
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
   * Handle webhook from Airtel Money
   */
  async getWebhookActionAndData(
    data: Record<string, unknown>
  ): Promise<WebhookActionData> {
    const { status, transaction } = data as any

    switch (status) {
      case "SUCCESS":
        return {
          action: "authorized",
          data: {
            session_id: transaction?.id,
            amount: transaction?.amount,
          },
        }
      case "FAILED":
        return {
          action: "failed",
          data: {
            session_id: transaction?.id,
            error: data.message || "Payment failed",
          },
        }
      default:
        return {
          action: "not_supported",
        }
    }
  }

  /**
   * Get access token from Airtel Money API
   */
  private async getAccessToken(): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/auth/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.options_.client_id,
          client_secret: this.options_.client_secret,
          grant_type: "client_credentials",
        }),
      }
    )

    if (!response.ok) {
      throw new Error("Failed to get Airtel Money access token")
    }

    const data = await response.json()
    return data.access_token
  }

  /**
   * Check payment status
   */
  private async checkPaymentStatus(transaction_id: string): Promise<string> {
    const access_token = await this.getAccessToken()

    const response = await fetch(
      `${this.baseUrl}/standard/v1/payments/${transaction_id}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${access_token}`,
          "X-Country": "ZM",
          "X-Currency": "ZMW",
        },
      }
    )

    if (!response.ok) {
      throw new Error("Failed to check payment status")
    }

    const data = await response.json()
    return data.data?.transaction?.status || "PENDING"
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `AIRTEL-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`
  }
}

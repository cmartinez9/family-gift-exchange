import type {NextConfig} from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

export default withNextIntl({
  agentRules: false,
  poweredByHeader: false,
  experimental: {serverActions: {bodySizeLimit: "4.5mb"}},
} satisfies NextConfig);

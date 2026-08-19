import { z } from "zod";


export const IpSchema = z.object({
    address: z.string().min(3),  // IP address eg. 192.168.12.24 or if CIDR then eg. "192.168.1.0/24"
    version: z.union([z.literal(4), z.literal(6)]), // IPv4/6
    cidr: z.boolean(), // address is CIDR
    //cidr: z.number().min(0).max(128).default(0), // if CIDR then CIDR suffix eg. "/24" is 24
    // 0 is interpreted as a single host i.e. the same as /32 (IPv4) or /128 (IPv6)
  });

export type IpType = z.infer<typeof IpSchema>;

export const PortSchema = z.object({
    num: z.number().min(0).max(65535),
    proto: z.string().min(1).catch("tcp")
  });

export type PortType = z.infer<typeof PortSchema>;

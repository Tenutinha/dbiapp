import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** The organization and client in the address of every "controle" endpoint. */
export const spaceParams = z.object({ org: slug, client: slug });

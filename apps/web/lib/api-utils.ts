import { NextResponse } from 'next/server';
import { type ZodError, type ZodTypeAny } from 'zod';
import { type UserRole } from '@equestrian/shared/types';
import { getTenantContext, TenantError } from './tenant';
import { hasPermission, PermissionError } from './permissions';
import { logger } from './logger';

interface ApiHandlerOptions {
  requiredPermission?: string;
}

interface AuthenticatedContext {
  clubId: string;
  memberId: string | null;
  userId: string;
  orgId: string;
  orgRole: UserRole;
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status },
  );
}

export function paginatedResponse<T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number },
) {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
    },
  });
}

/**
 * Validates input against a Zod schema. Returns the parsed output type,
 * which includes defaults applied by `.default()` modifiers.
 * Throws ValidationError with flattened details on failure.
 */
export function validateInput<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
): S['_output'] {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}

export class ValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  public readonly details: unknown;

  constructor(zodError: ZodError) {
    super('Invalid input');
    this.name = 'ValidationError';
    this.details = zodError.flatten();
  }
}

export async function withAuth(
  handler: (ctx: AuthenticatedContext) => Promise<NextResponse>,
  options?: ApiHandlerOptions,
): Promise<NextResponse> {
  try {
    const ctx = await getTenantContext();

    if (options?.requiredPermission) {
      if (!hasPermission(ctx.orgRole, options.requiredPermission)) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to perform this action',
          403,
        );
      }
    }

    return await handler(ctx);
  } catch (error) {
    if (error instanceof TenantError) {
      const status = error.code === 'UNAUTHORIZED' ? 401 : 400;
      return errorResponse(error.code, error.message, status);
    }

    if (error instanceof PermissionError) {
      return errorResponse('FORBIDDEN', error.message, 403);
    }

    if (error instanceof ValidationError) {
      return errorResponse('VALIDATION_ERROR', error.message, 400, error.details);
    }

    if (error instanceof SyntaxError) {
      return errorResponse('INVALID_JSON', 'Request body contains invalid JSON', 400);
    }

    logger.error('unhandled_api_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(
      'INTERNAL_ERROR',
      'Something went wrong. Please try again.',
      500,
    );
  }
}

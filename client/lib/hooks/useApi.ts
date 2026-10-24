"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseApiState<T> {
    data: T | null;
    error: string | null;
    isLoading: boolean;
}

interface UseApiOptions {
    /** Whether to fetch data immediately on mount */
    immediate?: boolean;
}

interface UseApiReturn<T> extends UseApiState<T> {
    /** Clear error state */
    clearError: () => void;
    /** Refetch the data */
    refetch: () => Promise<void>;
    /** Manually set the data (for optimistic updates) */
    setData: (data: T | null | ((prev: T | null) => T | null)) => void;
}

/**
 * Custom hook for API data fetching with loading, error, and refetch support
 */
export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions = {}): UseApiReturn<T> {
    const { immediate = true } = options;

    const [state, setState] = useState<UseApiState<T>>({
        data: null,
        error: null,
        isLoading: immediate,
    });

    // Keep track of the latest fetcher
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    // Track if component is mounted
    const mountedRef = useRef(true);

    const fetchData = useCallback(async () => {
        setState((prev) => ({ ...prev, error: null, isLoading: true }));

        try {
            const data = await fetcherRef.current();
            if (mountedRef.current) {
                setState({ data, error: null, isLoading: false });
            }
        } catch (err) {
            if (mountedRef.current) {
                setState((prev) => ({
                    ...prev,
                    error: err instanceof Error ? err.message : "An error occurred",
                    isLoading: false,
                }));
            }
        }
    }, []);

    const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
        setState((prev) => ({
            ...prev,
            data:
                typeof updater === "function"
                    ? (updater as (prev: T | null) => T | null)(prev.data)
                    : updater,
        }));
    }, []);

    const clearError = useCallback(() => {
        setState((prev) => ({ ...prev, error: null }));
    }, []);

    useEffect(() => {
        mountedRef.current = true;

        if (immediate) {
            fetchData();
        }

        return () => {
            mountedRef.current = false;
        };
    }, [immediate, fetchData]);

    return {
        ...state,
        clearError,
        refetch: fetchData,
        setData,
    };
}

/**
 * Hook for multiple related API calls (e.g., fetching groups and users together)
 */
export function useApiMultiple<T extends Record<string, unknown>>(
    fetchers: { [K in keyof T]: () => Promise<T[K]> },
    options: UseApiOptions = {}
): {
    data: T | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
} {
    const { immediate = true } = options;

    const [state, setState] = useState<{
        data: T | null;
        isLoading: boolean;
        error: string | null;
    }>({
        data: null,
        error: null,
        isLoading: immediate,
    });

    const fetchersRef = useRef(fetchers);
    fetchersRef.current = fetchers;
    const mountedRef = useRef(true);

    const fetchAll = useCallback(async () => {
        setState((prev) => ({ ...prev, error: null, isLoading: true }));

        try {
            const keys = Object.keys(fetchersRef.current) as (keyof T)[];
            const promises = keys.map((key) => fetchersRef.current[key]());
            const results = await Promise.all(promises);

            const data = keys.reduce((acc, key, index) => {
                acc[key] = results[index];
                return acc;
            }, {} as T);

            if (mountedRef.current) {
                setState({ data, error: null, isLoading: false });
            }
        } catch (err) {
            if (mountedRef.current) {
                setState((prev) => ({
                    ...prev,
                    error: err instanceof Error ? err.message : "An error occurred",
                    isLoading: false,
                }));
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;

        if (immediate) {
            fetchAll();
        }

        return () => {
            mountedRef.current = false;
        };
    }, [immediate, fetchAll]);

    return {
        ...state,
        refetch: fetchAll,
    };
}

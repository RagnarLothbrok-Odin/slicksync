"use client";

import { createContext, useContext } from "react";

interface UserMobileMenuContextType {
    isOpen: boolean;
    onClose: () => void;
    onOpen: () => void;
}

export const UserMobileMenuContext = createContext<UserMobileMenuContextType>({
    isOpen: false,
    onClose: () => undefined,
    onOpen: () => undefined,
});

export function useUserMobileMenu() {
    return useContext(UserMobileMenuContext);
}

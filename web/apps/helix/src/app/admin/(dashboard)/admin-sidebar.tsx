'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@helix/design-system/components/sidebar';
import { Boxes, Cpu, FileText, Hammer, Layers, Package, Users } from 'lucide-react';

import { HelixMark } from '@/components/logo';

import { AdminUserMenu } from './user-menu';

const NAV = [
  { href: '/admin/post', label: 'Posts', icon: FileText, exact: true },
  { href: '/admin/products', label: 'Products', icon: Boxes, exact: false },
  { href: '/admin/releases', label: 'Releases', icon: Package, exact: false },
  { href: '/admin/builds', label: 'Builds', icon: Hammer, exact: false },
  { href: '/admin/devices', label: 'Devices', icon: Cpu, exact: false },
  { href: '/admin/profiles', label: 'Profiles', icon: Layers, exact: false },
  { href: '/admin/users', label: 'Users', icon: Users, exact: false },
] as const;

export const AdminSidebar = ({ name, email }: { name: string; email: string }) => {
  const pathname = usePathname();
  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          className="flex items-center gap-2 px-2 py-1.5 font-semibold tracking-tight"
          href="/admin"
        >
          <HelixMark className="text-brand size-5" />
          <span>Helix</span>
          <span className="border-border/60 bg-muted/40 text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-xs font-normal">
            admin
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <AdminUserMenu email={email} name={name} />
      </SidebarFooter>
    </Sidebar>
  );
};

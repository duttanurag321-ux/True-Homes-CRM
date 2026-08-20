// One consistent, modern icon system for the whole app — Phosphor Icons
// (MIT licensed), rendered at "fill" weight for a bolder, rounder,
// SF-Symbols-like feel instead of the old thin hand-drawn strokes.
//
// This file is the ONLY thing that changed to modernize icons — every
// other file in the app still imports IconToday, IconCall, etc. from
// here by the same names, with the same `size`/`className` props, so
// nothing elsewhere needed to change.
import {
  CalendarCheck,
  Funnel,
  UsersThree,
  ChartBar,
  DotsThreeCircle,
  WhatsappLogo,
  Phone,
  Plus,
  CaretRight,
  CaretLeft,
  UploadSimple,
  Check,
  Fire,
  X,
  MagnifyingGlass,
  Tray,
  SlidersHorizontal,
  Calendar
} from '@phosphor-icons/react'

// `size` keeps its old per-icon default when the caller doesn't pass one;
// everything else (className, style, onClick, ...) still passes through
// untouched, same as the old `{...p}` spread. Color still comes from
// `currentColor`, so existing text-color classes on parents keep working.
function wrap(Icon, defaultSize) {
  return function WrappedIcon({ size, ...rest }) {
    return <Icon size={size || defaultSize} weight="fill" color="currentColor" {...rest} />
  }
}

export const IconToday = wrap(CalendarCheck, 24)
export const IconPipeline = wrap(Funnel, 24)
export const IconLeads = wrap(UsersThree, 24)
export const IconReports = wrap(ChartBar, 24)
export const IconMore = wrap(DotsThreeCircle, 24)
export const IconWhatsapp = wrap(WhatsappLogo, 20)
export const IconCall = wrap(Phone, 20)
export const IconPlus = wrap(Plus, 22)
export const IconChevron = wrap(CaretRight, 18)
export const IconBack = wrap(CaretLeft, 22)
export const IconUpload = wrap(UploadSimple, 20)
export const IconCheck = wrap(Check, 20)
export const IconFire = wrap(Fire, 18)
export const IconClose = wrap(X, 20)
export const IconSearch = wrap(MagnifyingGlass, 20)
export const IconInbox = wrap(Tray, 20)
export const IconFilter = wrap(SlidersHorizontal, 20)
export const IconCalendar = wrap(Calendar, 18)

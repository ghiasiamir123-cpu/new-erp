from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import Project

User = get_user_model()


class Command(BaseCommand):
    help = "Seed demo users and projects matching the original prototype defaults."

    def handle(self, *args, **options):
        demo_users = [
            {
                "username": "manager",
                "name": "مدیریت",
                "role": User.Role.MANAGER,
                "position": "مدیر کارخانه",
                "is_staff": True,
                "is_superuser": True,
            },
            {
                "username": "sarparast",
                "name": "سرپرست خط",
                "role": User.Role.DATA_ENTRY,
                "position": "سرپرست",
            },
            {
                "username": "viewer",
                "name": "ناظر",
                "role": User.Role.VIEWER,
                "position": "کنترل کیفیت",
            },
        ]
        for u in demo_users:
            username = u.pop("username")
            user, created = User.objects.get_or_create(username=username, defaults=u)
            if created:
                user.set_password("1234")
                user.save()
                self.stdout.write(self.style.SUCCESS(f"کاربر ساخته شد: {username} / 1234"))
            else:
                self.stdout.write(f"کاربر از قبل موجود است: {username}")

        demo_projects = [
            {"name": "کابینت آشپزخانه", "code": "KIT"},
            {"name": "کمد دیواری", "code": "WRD"},
        ]
        for p in demo_projects:
            project, created = Project.objects.get_or_create(name=p["name"], defaults=p)
            if created:
                self.stdout.write(self.style.SUCCESS(f"پروژه ساخته شد: {p['name']}"))
            else:
                self.stdout.write(f"پروژه از قبل موجود است: {p['name']}")

from django.shortcuts import render

def default_view(request):
    return render(request, 'welcome.html')

def about_view(request):
    return render(request, 'about.html')



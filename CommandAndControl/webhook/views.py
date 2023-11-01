from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
import json
import hmac
import hashlib
import os


@csrf_exempt
def webhook_view(request):
    if request.method == 'POST':
        payload = json.loads(request.body)
        event = request.headers.get('X-GitHub-Event')        
        secret = os.getenv('WebhookSecret','InvalidSecret').encode()
        signature = request.headers.get('X-Hub-Signature')
        calculated_signature = 'sha1=' + hmac.new(secret, request.body, hashlib.sha1).hexdigest()

        if not hmac.compare_digest(signature, calculated_signature):
             return JsonResponse({'error': 'Forbidden'}, status=403)
        
        if event == 'push':
            ref = payload.get('ref', '')
            if ref == 'refs/heads/main':  # or 'refs/heads/master' for master branch
                with open('/tmp/GitPullPipe', 'w') as pipe:
                    pipe.write('trigger\n')
            
        
        return JsonResponse({'status': 'ok'})
    else:
        return JsonResponse({'error': 'Method not allowed'}, status=405)
